import { QueryRequest } from '@logsn/protocol';
import { StreamPartIDUtils } from '@streamr/protocol';
import { EthereumAddress, Logger } from '@streamr/utils';
import { Schema } from 'ajv';
import { Stream } from 'streamr-client';

import { NetworkModeConfig, PluginOptions } from '../../../Plugin';
import { BroadbandPublisher } from '../../../shared/BroadbandPublisher';
import { BroadbandSubscriber } from '../../../shared/BroadbandSubscriber';
import PLUGIN_CONFIG_SCHEMA from '../config.schema.json';
import { createNotaryPubKeyFetchEndpoint } from '../http/notaryGateway';
import { createNotaryVerifyEndpoint } from '../http/notaryVerifier';
import { createRecoveryEndpoint } from '../http/recoveryEndpoint';
import { LogStorePlugin } from '../LogStorePlugin';
import { proverSocketPath } from '../Prover';
import { WEBSERVER_PATHS } from '../subprocess/constants';
import { ProcessManager } from '../subprocess/ProcessManager';
import { Heartbeat } from './Heartbeat';
import { KyvePool } from './KyvePool';
import { LogStoreNetworkConfig } from './LogStoreNetworkConfig';
import { MessageMetricsCollector } from './MessageMetricsCollector';
import { NetworkProver } from './NetworkProver';
import { NetworkQueryRequestManager } from './NetworkQueryRequestManager';
import { PropagationDispatcher } from './PropagationDispatcher';
import { PropagationResolver } from './PropagationResolver';
import { QueryResponseManager } from './QueryResponseManager';
import { ReportPoller } from './ReportPoller';
import { SystemCache } from './SystemCache';
import { SystemRecovery } from './SystemRecovery';

const METRICS_INTERVAL = 60 * 1000;
export const NOTARY_PORT = 7047;

const logger = new Logger(module);

export class LogStoreNetworkPlugin extends LogStorePlugin {
	private readonly systemSubscriber: BroadbandSubscriber;
	private readonly systemPublisher: BroadbandPublisher;
	private readonly heartbeatPublisher: BroadbandPublisher;
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
	private readonly notaryServer: ProcessManager;
	private readonly proxyRequestProver: NetworkProver;

	private metricsTimer?: NodeJS.Timer;

	constructor(options: PluginOptions) {
		super(options);

		this.notaryServer = new ProcessManager(
			'notary',
			WEBSERVER_PATHS.notary(),
			({ port }) => [`--port`, port.toString()],
			NOTARY_PORT
		);

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

		this.kyvePool = new KyvePool(
			networkStrictNodeConfig.pool.url,
			networkStrictNodeConfig.pool.id
		);

		this.heartbeatPublisher = new BroadbandPublisher(
			this.streamrClient,
			this.networkConfig.heartbeatStream
		);

		this.heartbeat = new Heartbeat(
			this.logStoreClient,
			this.heartbeatPublisher
		);

		this.messageMetricsCollector = new MessageMetricsCollector(
			this.streamrClient,
			this.systemSubscriber,
			this.networkConfig.recoveryStream
		);

		this.systemCache = new SystemCache(this.systemSubscriber, this.kyvePool);

		this.systemRecovery = new SystemRecovery(
			this.streamrClient,
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
			networkStrictNodeConfig.pool,
			this.signer,
			this.systemPublisher,
			this.systemSubscriber
		);

		this.proxyRequestProver = new NetworkProver(
			proverSocketPath,
			this.streamrClient
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

		if (this.pluginConfig.experimental?.enableValidator) {
			// start the report polling process
			const abortController = new AbortController();
			await this.reportPoller.start(abortController.signal);
			await this.systemCache.start();
			await this.systemRecovery.start();
		}

		await this.networkQueryRequestManager.start(this.logStore);
		await this.queryResponseManager.start(clientId);
		await this.messageMetricsCollector.start();
		await this.proxyRequestProver.start();

		if (this.pluginConfig.experimental?.enableValidator) {
			this.addHttpServerEndpoint(
				createRecoveryEndpoint(
					this.networkConfig.systemStream,
					this.heartbeat,
					this.metricsContext
				)
			);
		}

		// start the notary server and create an endpoint to get the keys
		await this.notaryServer.start();
		this.addHttpServerEndpoint(createNotaryPubKeyFetchEndpoint());
		this.addHttpServerEndpoint(createNotaryVerifyEndpoint(this.signer));

		this.metricsTimer = setInterval(
			this.logMetrics.bind(this),
			METRICS_INTERVAL
		);
	}

	override async stop(): Promise<void> {
		clearInterval(this.metricsTimer);

		const stopValidatorComponents = async () => {
			await Promise.all([
				this.reportPoller.stop(),
				this.systemCache.stop(),
				this.systemRecovery.stop(),
			]);
		};

		await Promise.all([
			super.stop(),
			this.messageMetricsCollector.stop(),
			this.heartbeat.stop(),
			this.propagationResolver.stop(),
			this.networkQueryRequestManager.stop(),
			this.queryResponseManager.stop(),
			this.pluginConfig.experimental?.enableValidator
				? stopValidatorComponents()
				: Promise.resolve(),
			this.proxyRequestProver.stop(),
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
						await node.subscribeAndWaitForJoin(streamPart); // best-effort, can time out
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
					node.unsubscribe(streamPart);
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
