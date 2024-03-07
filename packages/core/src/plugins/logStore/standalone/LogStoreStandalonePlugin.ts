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
import { SinkModule } from '../Sink';
import { WEBSERVER_PATHS } from '../subprocess/constants';
import { ProcessManager } from '../subprocess/ProcessManager';
import { getNextAvailablePort } from '../subprocess/utils';
import { LogStoreStandaloneConfig } from './LogStoreStandaloneConfig';
import { StandAloneProver } from './StandAloneProver';

const logger = new Logger(module);
// TODO make notary connection mode a more global setting?
// this variable is responsible for the prover's connection to the notary server
// if it is dev, then the notary server knows to use the default ssl certificate in the fixtures
// and if it is not, it will use the domain passed in which is that of the closest notary node gotten from the heartbeat
const MODE: 'dev' | 'prod' = 'dev';

export class LogStoreStandalonePlugin extends LogStorePlugin {
	private standaloneQueryRequestManager: BaseQueryRequestManager;
	private proverServer: ProcessManager;
	private hearbeatMonitor: HeartbeatMonitor;
	private readonly proxyRequestProver: StandAloneProver;
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
		this.proxyRequestProver = new StandAloneProver(
			proverSocketPath,
			this.streamrClient
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
		await this.proxyRequestProver.start();
		await this.standaloneQueryRequestManager.start(this.logStore);
		await this.hearbeatMonitor.start(await this.streamrClient.getAddress());
		await this.sinkModule.start(this.logStore);

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
		const notaryURL = `${notaryNodeURL.hostname}:${NOTARY_PORT}`;
		this.proverServer.start(['--url', notaryURL, '--mode', MODE]);
	}

	override async stop(): Promise<void> {
		await Promise.all([
			super.stop(),
			this.maybeLogStoreConfig?.destroy(),
			this.proverServer.stop(),
			this.proxyRequestProver.stop(),
			this.hearbeatMonitor.stop(),
		]);
		await this.proxyRequestProver.start();
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
