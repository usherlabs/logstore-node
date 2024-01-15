import { toStreamPartID } from '@streamr/protocol';
import { Logger } from '@streamr/utils';
import { Schema } from 'ajv';
import {
	EthereumAddress,
	formStorageNodeAssignmentStreamId,
	Stream,
} from 'streamr-client';

import { Plugin } from '../../Plugin';
import PLUGIN_CONFIG_SCHEMA from './config.schema.json';
import { StorageConfig } from './StorageConfig';
import { StorageProxyPluginConfig } from './StorageProxyPluginConfig';

const logger = new Logger(module);

export class StorageProxyPlugin extends Plugin<StorageProxyPluginConfig> {
	private storageConfig?: StorageConfig;

	async start(): Promise<void> {
		const clusterId = this.pluginConfig.cluster.clusterAddress;
		const assignmentStream = await this.streamrClient.getStream(
			formStorageNodeAssignmentStreamId(clusterId)
		);
		this.storageConfig = await this.startStorageConfig(
			clusterId,
			assignmentStream
		);
	}

	async stop(): Promise<void> {
		this.storageConfig!.destroy();
	}

	override getConfigSchema(): Schema {
		return PLUGIN_CONFIG_SCHEMA;
	}

	private async startStorageConfig(
		clusterId: EthereumAddress,
		assignmentStream: Stream
	): Promise<StorageConfig> {
		const storageConfig = new StorageConfig(
			clusterId,
			this.pluginConfig.storageConfig.refreshInterval,
			this.streamrClient,
			{
				onStreamAdded: async (streamID) => {
					if (await this.logStoreClient.isLogStoreStream(streamID)) {
						return;
					}

					try {
						const stream = await this.streamrClient.getStream(streamID);

						const amount = BigInt(
							this.pluginConfig.storageConfig.storeStakeAmount
						);
						const tx = await this.logStoreClient.stakeOrCreateStore(
							stream.id,
							amount
						);
						await tx.wait();

						try {
							// Publish an assignment messages of all the partitions of the stream
							// to let StreamrClient confirm that the stream added to a storage
							const { partitions } = stream.getMetadata();
							for (let partition = 0; partition < partitions; partition++) {
								await assignmentStream.publish({
									streamPart: toStreamPartID(stream.id, partition),
								});
								logger.debug('Published message to assignment stream', {
									assignmentStreamId: assignmentStream.id,
								});
							}
						} catch (err) {
							logger.warn('Failed to publish to assignment stream', {
								assignmentStreamId: assignmentStream.id,
								err,
							});
						}
					} catch (error) {
						logger.error('Failed to create Store for a proxied stream', {
							error,
						});
					}
				},
				onStreamRemoved: (_streamID) => {
					// TODO: Unstake from the Store?
				},
			}
		);
		await storageConfig.start();
		return storageConfig;
	}
}
