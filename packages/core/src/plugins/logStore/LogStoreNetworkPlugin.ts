import { Stream } from '@logsn/client';
import { QueryRequest } from '@logsn/protocol';
import { getQueryManagerContract } from '@logsn/shared';
import { EthereumAddress, Logger } from '@streamr/utils';
import { Schema } from 'ajv';
import { ethers } from 'ethers';

import { NetworkModeConfig, PluginOptions } from '../../Plugin';
import { BroadbandPublisher } from '../../shared/BroadbandPublisher';
import { BroadbandSubscriber } from '../../shared/BroadbandSubscriber';
import PLUGIN_CONFIG_SCHEMA from './config.schema.json';
import { Heartbeat } from './Heartbeat';
import { KyvePool } from './KyvePool';
import { LogStoreNetworkConfig } from './LogStoreConfig';
import { LogStorePlugin } from './LogStorePlugin';
import { MessageMetricsCollector } from './MessageMetricsCollector';
import { NetworkQueryRequestManager } from './NetworkQueryRequestManager';
import { PropagationDispatcher } from './PropagationDispatcher';
import { PropagationResolver } from './PropagationResolver';
import { QueryResponseManager } from './QueryResponseManager';
import { createRecoveryEndpoint } from './recoveryEndpoint';
import { ReportPoller } from './ReportPoller';
import { SystemCache } from './SystemCache';
import { SystemRecovery } from './SystemRecovery';

const METRICS_INTERVAL = 60 * 1000;

const logger = new Logger(module);

export class LogStoreNetworkPlugin extends LogStorePlugin {
	private readonly systemSubscriber: BroadbandSubscriber;
	private readonly systemPublisher: BroadbandPublisher;
	private readonly heartbeatPublisher: BroadbandPublisher;
	private readonly heartbeatSubscriber: BroadbandSubscriber;
	private readonly kyvePool: KyvePool;
	private readonly messageMetricsCollector: MessageMetricsCollector;
	private readonly heartbeat: Heartbeat;
	private readonly systemCache: SystemCache;
	private readonly systemRecovery: SystemRecovery;
	private readonly networkQueryRequestManager: NetworkQueryRequestManager;
	private readonly queryResponseManager: QueryResponseManager;
	private readonly propagationResolver: PropagationResolver;
	private readonly propagationDispatcher: PropagationDispatcher;
	private readonly reportPoller: ReportPoller;

	private metricsTimer?: NodeJS.Timer;

	constructor(options: PluginOptions) {
		super(options);

		const networkStrictBrokerConfig =
			this.brokerConfig.mode?.type === 'network-participant'
				? this.brokerConfig.mode
				: undefined;

		if (!networkStrictBrokerConfig) {
			throw new Error('Network config is undefined');
		}

		this.systemPublisher = new BroadbandPublisher(
			this.logStoreClient,
			this.networkConfig.systemStream
		);

		this.systemSubscriber = new BroadbandSubscriber(
			this.logStoreClient,
			this.networkConfig.systemStream
		);

		this.kyvePool = new KyvePool(
			networkStrictBrokerConfig.pool.url,
			networkStrictBrokerConfig.pool.id
		);

		this.heartbeatSubscriber = new BroadbandSubscriber(
			this.logStoreClient,
			this.networkConfig.heartbeatStream
		);

		this.heartbeatPublisher = new BroadbandPublisher(
			this.logStoreClient,
			this.networkConfig.heartbeatStream
		);

		this.heartbeat = new Heartbeat(
			this.heartbeatPublisher,
			this.heartbeatSubscriber
		);

		this.messageMetricsCollector = new MessageMetricsCollector(
			this.logStoreClient,
			this.systemSubscriber,
			this.networkConfig.recoveryStream
		);

		this.systemCache = new SystemCache(this.systemSubscriber, this.kyvePool);

		this.systemRecovery = new SystemRecovery(
			this.logStoreClient,
			this.networkConfig.recoveryStream,
			this.networkConfig.systemStream,
			this.systemCache
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

		this.reportPoller = new ReportPoller(
			this.kyvePool,
			networkStrictBrokerConfig.pool,
			this.signer,
			this.systemPublisher,
			this.systemSubscriber
		);
	}

	get networkConfig(): NetworkModeConfig {
		if (this.modeConfig.type !== 'network-participant') {
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

		const clientId = await this.logStoreClient.getAddress();

		await this.heartbeat.start(clientId);
		await this.propagationResolver.start(this.logStore);
		this.propagationDispatcher.start(this.logStore);

		if (this.pluginConfig.experimental?.enableValidator) {
			// start the report polling process
			const abortController = new AbortController();
			this.reportPoller.start(abortController.signal);
			await this.systemCache.start();
			await this.systemRecovery.start();
		}

		await this.networkQueryRequestManager.start(this.logStore);
		await this.queryResponseManager.start(clientId);
		await this.messageMetricsCollector.start();

		if (this.pluginConfig.experimental?.enableValidator) {
			this.addHttpServerEndpoint(
				createRecoveryEndpoint(
					this.networkConfig.systemStream,
					this.heartbeat,
					this.metricsContext
				)
			);
		}

		this.metricsTimer = setInterval(
			this.logMetrics.bind(this),
			METRICS_INTERVAL
		);
	}

	override async stop(): Promise<void> {
		clearInterval(this.metricsTimer);

		const stopValidatorComponents = async () => {
			await Promise.all([this.systemCache.stop(), this.systemRecovery.stop()]);
		};

		await Promise.all([
			this.messageMetricsCollector.stop(),
			this.heartbeat.stop(),
			this.propagationResolver.stop(),
			this.networkQueryRequestManager.stop(),
			this.queryResponseManager.stop(),
			this.pluginConfig.experimental?.enableValidator
				? stopValidatorComponents()
				: Promise.resolve(),
		]);
	}

	// eslint-disable-next-line class-methods-use-this
	override getConfigSchema(): Schema {
		return PLUGIN_CONFIG_SCHEMA;
	}

	private async startNetworkLogStoreConfig(
		systemStream: Stream
	): Promise<LogStoreNetworkConfig> {
		const node = await this.logStoreClient.getNode();

		const logStoreConfig = new LogStoreNetworkConfig(
			this.pluginConfig.cluster.clusterSize,
			this.pluginConfig.cluster.myIndexInCluster,
			this.pluginConfig.logStoreConfig.refreshInterval,
			this.logStoreClient,
			{
				onStreamPartAdded: async (streamPart) => {
					try {
						await node.subscribeAndWaitForJoin(streamPart); // best-effort, can time out
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
						logger.debug(
							'published Assignment message to system stream %s',
							systemStream.id
						);
					} catch (e) {
						logger.warn(
							'failed to publish to system stream %s, reason: %s',
							systemStream.id,
							e
						);
					}
				},
				onStreamPartRemoved: (streamPart) => {
					node.unsubscribe(streamPart);
				},
			}
		);
		await logStoreConfig.start();
		return logStoreConfig;
	}

	public async processQueryRequest(queryRequest: QueryRequest) {
		const { participatingNodes } =
			await this.networkQueryRequestManager.publishQueryRequestAndWaitForPropagateResolution(
				queryRequest
			);

		const data =
			this.networkQueryRequestManager.getDataForQueryRequest(queryRequest);

		return {
			data,
			participatingNodes,
		};
	}

	public async validateUserQueryAccess(address: EthereumAddress) {
		const provider = new ethers.providers.JsonRpcProvider(
			this.brokerConfig.client.contracts?.streamRegistryChainRPCs!.rpcs[0]
		);
		const queryManager = await getQueryManagerContract(provider);
		const balance = await queryManager.balanceOf(address);
		if (!balance.gt(0)) {
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
