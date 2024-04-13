import { QueryRequest } from '@logsn/protocol';
import {
	StreamPartIDUtils,
	toStreamID,
	toStreamPartID,
} from '@streamr/protocol';
import { Logger } from '@streamr/utils';
import _ from 'lodash';

import { PluginOptions, StandaloneModeConfig } from '../../../Plugin';
import { BaseQueryRequestManager } from '../BaseQueryRequestManager';
import { HeartbeatMonitor, NodeHeartbeat } from '../HeartbeatMonitor';
import { LogStorePlugin } from '../LogStorePlugin';
import { NOTARY_PORT } from '../network/LogStoreNetworkPlugin';
import { proverSocketPath } from '../Prover';
import { WEBSERVER_PATHS } from '../subprocess/constants';
import { ProcessManager } from '../subprocess/ProcessManager';
import { getNextAvailablePort } from '../subprocess/utils';
import { LogStoreStandaloneConfig } from './LogStoreStandaloneConfig';
import { SinkModule } from './sink';
import { StandaloneProver } from './StandaloneProver';

const logger = new Logger(module);
type ProverModeType = 'dev' | 'prod';

// TODO make notary connection mode a more global setting?
// this variable is responsible for the prover's connection to the notary server
// if it is dev, then the notary server knows to use the default ssl certificate in the fixtures
// and if it is not, it will use the domain passed in which is that of the closest notary node gotten from the heartbeat
const PROVER_MODE: ProverModeType =
	process.env.PROVER_MODE == 'dev' ? 'dev' : 'prod';
const OVERRIDE_NOTARY_URL = process.env.NOTARY_URL;
const EXPERIMENTAL_SOROBAN_SINK =
	process.env.EXPERIMENTAL_SOROBAN_SINK === 'true';

export class LogStoreStandalonePlugin extends LogStorePlugin {
	private standaloneQueryRequestManager: BaseQueryRequestManager;
	private proverServer: ProcessManager;
	private hearbeatMonitor: HeartbeatMonitor;
	private readonly proxyRequestProver: StandaloneProver;
	private sinkModule: SinkModule;

	constructor(options: PluginOptions) {
		super(options);

		this.proverServer = new ProcessManager(
			'prover',
			WEBSERVER_PATHS.prover(),
			({ port }) => [`--port`, port.toString()],
			getNextAvailablePort(options.nodeConfig.httpServer.port)
		);

		this.hearbeatMonitor = new HeartbeatMonitor(this.logStoreClient);

		this.standaloneQueryRequestManager = new BaseQueryRequestManager();

		this.proxyRequestProver = new StandaloneProver(
			proverSocketPath,
			this.streamrClient,
			EXPERIMENTAL_SOROBAN_SINK
		);
		this.sinkModule = new SinkModule();
	}

	private get standaloneConfig(): StandaloneModeConfig {
		if (this.modeConfig.type !== 'standalone') {
			throw new Error(
				'Something went wrong, this should be a standalone plugin'
			);
		}
		return this.modeConfig;
	}

	override async start(): Promise<void> {
		this.maybeLogStoreConfig = await this.startStandaloneLogStoreConfig();
		// this should be called after the logStoreConfig is initialized
		await super.start();
		await this.standaloneQueryRequestManager.start(this.logStore);
		await this.hearbeatMonitor.start(await this.streamrClient.getAddress());

		// TODO: Determine how experiment sits in wider repository.
		if (EXPERIMENTAL_SOROBAN_SINK) {
			await this.sinkModule.start(this.logStore);
		}

		// wait until we can get a notary node
		// poll online nodes for url
		const notaryNode: NodeHeartbeat = await new Promise((resolve) => {
			const POLL_INTERVAL_MS = 500;
			const interval = setInterval(() => {
				const { onlineNodesInfo } = this.hearbeatMonitor;
				const onlineHttpNode = onlineNodesInfo.find((node) =>
					Boolean(node.url)
				);
				if (onlineHttpNode) {
					clearInterval(interval);
					resolve(onlineHttpNode);
				}
			}, POLL_INTERVAL_MS);
		});

		// when starting the prover server, we need to provide the notary url to connect to
		const notaryNodeURL = new URL(String(notaryNode.url));
		// TODO: In the future: Selection should be dynamic and the number of notaries can be configured for parallel processing.
		const notaryURL = OVERRIDE_NOTARY_URL
			? `${OVERRIDE_NOTARY_URL.split(':')[0]}:${NOTARY_PORT}`
			: `${notaryNodeURL.hostname}:${NOTARY_PORT}`;
		this.proverServer.start(['--url', notaryURL, '--mode', PROVER_MODE]);

		await this.proxyRequestProver.start(notaryNode);
	}

	override async stop(): Promise<void> {
		await Promise.all([
			super.stop(),
			this.maybeLogStoreConfig?.destroy(),
			this.proverServer.stop(),
			this.proxyRequestProver.stop(),
			this.hearbeatMonitor.stop(),
		]);
	}

	public async processQueryRequest(queryRequest: QueryRequest) {
		const data =
			this.standaloneQueryRequestManager.getDataForQueryRequest(queryRequest);
		const nodeId = await this.streamrClient.getAddress();
		return {
			participatingNodes: [nodeId],
			data,
		};
	}

	public async validateUserQueryAccess() {
		return { valid: true } as const;
	}

	private async startStandaloneLogStoreConfig(): Promise<LogStoreStandaloneConfig> {
		const streamPartIds = this.standaloneConfig.trackedStreams.flatMap(
			({ id, partitions }) =>
				_.range(partitions).map((partition) =>
					toStreamPartID(toStreamID(id), partition)
				)
		);

		const node = await this.streamrClient.getNode();

		const logStoreConfig = new LogStoreStandaloneConfig(streamPartIds, {
			onStreamPartAdded: async (streamPart) => {
				try {
					logger.debug(
						`Subscribing to stream part ${StreamPartIDUtils.getStreamID(
							streamPart
						)}`
					);
					await node.subscribeAndWaitForJoin(streamPart); // best-effort, can time out
					await this.nodeStreamsRegistry.registerStreamId(
						StreamPartIDUtils.getStreamID(streamPart)
					);
				} catch (_e) {
					// no-op
				}
			},
			onStreamPartRemoved: async (streamPart) => {
				node.unsubscribe(streamPart);
				await this.nodeStreamsRegistry.unregisterStreamId(
					StreamPartIDUtils.getStreamID(streamPart)
				);
			},
		});
		return logStoreConfig;
	}
}
