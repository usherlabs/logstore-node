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
import { HeartbeatMonitor } from '../HeartbeatMonitor';
import { WEBSERVER_PATHS } from '../http-proxy/constants';
import { ProxiedWebServerProcess } from '../http-proxy/ProxiedWebServerProcess';
import { LogStorePlugin } from '../LogStorePlugin';
import { LogStoreStandaloneConfig } from './LogStoreStandaloneConfig';

const logger = new Logger(module);

export class LogStoreStandalonePlugin extends LogStorePlugin {
	private standaloneQueryRequestManager: BaseQueryRequestManager;
	private proverServer: ProxiedWebServerProcess;
	private hearbeatMonitor: HeartbeatMonitor;

	constructor(options: PluginOptions) {
		super(options);

		this.proverServer = new ProxiedWebServerProcess(
			'prover',
			WEBSERVER_PATHS.prover(),
			({ port }) => [`-p`, port.toString()],
			'/prover/',
			this.reverseProxy
		);

		this.hearbeatMonitor = new HeartbeatMonitor(this.logStoreClient);

		this.standaloneQueryRequestManager = new BaseQueryRequestManager();
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
		await this.proverServer.start();
		await this.hearbeatMonitor.start(await this.streamrClient.getAddress());
	}

	override async stop(): Promise<void> {
		await Promise.all([
			super.stop(),
			this.maybeLogStoreConfig?.destroy(),
			this.proverServer.stop(),
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
