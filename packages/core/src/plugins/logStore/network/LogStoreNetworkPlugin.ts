import { QueryRequest } from '@logsn/protocol';
import { StreamPartIDUtils } from '@streamr/protocol';
import { Stream } from '@streamr/sdk';
import { EthereumAddress, executeSafePromise, Logger } from '@streamr/utils';
import { Schema } from 'ajv';

import { NetworkModeConfig, PluginOptions } from '../../../Plugin';
import { BroadbandPublisher } from '../../../shared/BroadbandPublisher';
import { BroadbandSubscriber } from '../../../shared/BroadbandSubscriber';
import PLUGIN_CONFIG_SCHEMA from '../config.schema.json';
import { LogStorePlugin } from '../LogStorePlugin';
import { Heartbeat } from './Heartbeat';
import { LogStoreNetworkConfig } from './LogStoreNetworkConfig';
import { MessageMetricsCollector } from './MessageMetricsCollector';
import { NetworkQueryRequestManager } from './NetworkQueryRequestManager';
import { PropagationDispatcher } from './PropagationDispatcher';
import { PropagationResolver } from './PropagationResolver';
import { QueryResponseManager } from './QueryResponseManager';

const METRICS_INTERVAL = 60 * 1000;

const logger = new Logger(module);

export class LogStoreNetworkPlugin extends LogStorePlugin {
	private readonly systemSubscriber: BroadbandSubscriber;
	private readonly systemPublisher: BroadbandPublisher;
	private readonly heartbeatPublisher: BroadbandPublisher;
	private readonly heartbeatSubscriber: BroadbandSubscriber;
	private readonly messageMetricsCollector: MessageMetricsCollector;
	private readonly heartbeat: Heartbeat;
	private readonly networkQueryRequestManager: NetworkQueryRequestManager;
	private readonly queryResponseManager: QueryResponseManager;
	private readonly propagationResolver: PropagationResolver;
	private readonly propagationDispatcher: PropagationDispatcher;

	private metricsTimer?: NodeJS.Timer;

	constructor(options: PluginOptions) {
		super(options);

		const networkStrictNodeConfig =
			this.nodeConfig.mode?.type === 'network'
				? this.nodeConfig.mode
				: undefined;

		if (!networkStrictNodeConfig) {
			throw new Error('Network config is undefined');
		}

		this.systemPublisher = new BroadbandPublisher(
			this.streamrClient,
			this.networkConfig.systemStream
		);

		this.systemSubscriber = new BroadbandSubscriber(
			this.streamrClient,
			this.networkConfig.systemStream
		);

		this.heartbeatSubscriber = new BroadbandSubscriber(
			this.streamrClient,
			this.networkConfig.heartbeatStream
		);

		this.heartbeatPublisher = new BroadbandPublisher(
			this.streamrClient,
			this.networkConfig.heartbeatStream
		);

		this.heartbeat = new Heartbeat(
			this.heartbeatPublisher,
			this.heartbeatSubscriber
		);

		this.messageMetricsCollector = new MessageMetricsCollector(
			this.systemSubscriber
		);

		this.propagationResolver = new PropagationResolver(
			this.heartbeat,
			this.systemSubscriber
		);

		this.propagationDispatcher = new PropagationDispatcher(
			this.systemPublisher
		);

		this.queryResponseManager = new QueryResponseManager(
			this.systemPublisher,
			this.systemSubscriber,
			this.propagationResolver,
			this.propagationDispatcher
		);

		this.networkQueryRequestManager = new NetworkQueryRequestManager(
			this.queryResponseManager,
			this.propagationResolver,
			this.systemPublisher,
			this.systemSubscriber
		);
	}

	get networkConfig(): NetworkModeConfig {
		if (this.modeConfig.type !== 'network') {
			throw new Error('Something went wrong, this should be a network plugin');
		}
		return this.modeConfig;
	}

	override async start(): Promise<void> {
		this.maybeLogStoreConfig = await this.startNetworkLogStoreConfig(
			this.networkConfig.systemStream
		);

		// this should be called after the logStoreConfig is initialized
		await super.start();

		const clientId = await this.streamrClient.getAddress();

		await this.heartbeat.start(clientId);
		await this.propagationResolver.start(this.logStore);
		this.propagationDispatcher.start(this.logStore);

		await this.networkQueryRequestManager.start(this.logStore);
		await this.queryResponseManager.start(clientId);
		await this.messageMetricsCollector.start();

		this.metricsTimer = setInterval(
			this.logMetrics.bind(this),
			METRICS_INTERVAL
		);
	}

	override async stop(): Promise<void> {
		clearInterval(this.metricsTimer);

		await Promise.all([
			this.messageMetricsCollector.stop(),
			this.heartbeat.stop(),
			this.propagationResolver.stop(),
			this.networkQueryRequestManager.stop(),
			this.queryResponseManager.stop(),
		]);

		await super.stop();
	}

	// eslint-disable-next-line class-methods-use-this
	override getConfigSchema(): Schema {
		return PLUGIN_CONFIG_SCHEMA;
	}

	private async startNetworkLogStoreConfig(
		systemStream: Stream
	): Promise<LogStoreNetworkConfig> {
		const node = await this.streamrClient.getNode();

		const logStoreConfig = new LogStoreNetworkConfig(
			this.pluginConfig.cluster.clusterSize,
			this.pluginConfig.cluster.myIndexInCluster,
			this.pluginConfig.logStoreConfig.refreshInterval,
			this.logStoreClient,
			this.streamrClient,
			{
				onStreamPartAdded: async (streamPart) => {
					try {
						await node.join(streamPart, { minCount: 1, timeout: 5000 }); // best-effort, can time out
						await this.nodeStreamsRegistry.registerStreamId(
							StreamPartIDUtils.getStreamID(streamPart)
						);
					} catch (_e) {
						// no-op
					}
					try {
						// TODO: Temporary disabled sending of assignment messages through the system stream.
						// Originally, it has been sending the message to the `assignments` stream as a plaing `streamPart` sting,
						// which then has been listened by waitForAssignmentsToPropagate func on the client.
						// Need to get back to it later!!!
						// await systemStream.publish({
						// 	streamPart,
						// });
						logger.debug('published Assignment message to system stream', {
							streamrId: systemStream.id,
						});
					} catch (e) {
						logger.warn('failed to publish to system stream', {
							streamId: systemStream.id,
							error: e,
						});
					}
				},
				onStreamPartRemoved: async (streamPart) => {
					executeSafePromise(() => node.leave(streamPart));
					await this.nodeStreamsRegistry.unregisterStreamId(
						StreamPartIDUtils.getStreamID(streamPart)
					);
				},
			}
		);
		await logStoreConfig.start();
		return logStoreConfig;
	}

	public async processQueryRequest(queryRequest: QueryRequest) {
		const data =
			this.networkQueryRequestManager.getDataForQueryRequest(queryRequest);

		return {
			data,
		};
	}

	public async validateUserQueryAccess(address: EthereumAddress) {
		const balance = await this.logStoreClient.getQueryBalanceOf(address);
		if (balance <= 0) {
			return {
				valid: false,
				message: 'Not enough balance staked for query',
			} as const;
		} else {
			return {
				valid: true,
			} as const;
		}
	}

	private logMetrics() {
		logger.info(
			`Metrics ${JSON.stringify(this.messageMetricsCollector.summary)}`
		);
	}
}
