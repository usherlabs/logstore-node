import { QueryRequest } from '@logsn/protocol';
import { toStreamID, toStreamPartID } from '@streamr/protocol';
import { Logger } from '@streamr/utils';
import _ from 'lodash';

import { PluginOptions, StandaloneModeConfig } from '../../Plugin';
import { LogStoreStandaloneConfig } from './LogStoreConfig';
import { LogStorePlugin } from './LogStorePlugin';
import { StandaloneQueryRequestManager } from './StandaloneQueryRequestManager';

const logger = new Logger(module);

export class LogStoreStandalonePlugin extends LogStorePlugin {
	private standaloneQueryRequestManager: StandaloneQueryRequestManager;

	constructor(options: PluginOptions) {
		super(options);
		this.standaloneQueryRequestManager = new StandaloneQueryRequestManager();
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
	}

	override async stop(): Promise<void> {
		await this.maybeLogStoreConfig?.destroy();
	}

	public async processQueryRequest(queryRequest: QueryRequest) {
		const data =
			this.standaloneQueryRequestManager.getDataForQueryRequest(queryRequest);
		const nodeId = await this.logStoreClient.getAddress();
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

		const node = await this.logStoreClient.getNode();

		const logStoreConfig = new LogStoreStandaloneConfig(streamPartIds, {
			onStreamPartAdded: async (streamPart) => {
				try {
					await node.subscribeAndWaitForJoin(streamPart); // best-effort, can time out
				} catch (_e) {
					// no-op
				}
			},
			onStreamPartRemoved: (streamPart) => {
				node.unsubscribe(streamPart);
			},
		});
		return logStoreConfig;
	}
}