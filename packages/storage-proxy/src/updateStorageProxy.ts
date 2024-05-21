import { StorageNodeMetadata } from '@streamr/sdk';
import { Logger } from '@streamr/utils';

import { getStreamrClient } from './utils/getStreamrClient';

const logger = new Logger(module);

interface Options {
	privateKey: string;
	metadata: StorageNodeMetadata;
	devNetwork?: boolean;
}

export const updateStorageProxy = async (options: Options) => {
	const streamrClient = getStreamrClient(options);
	const clusterId = await streamrClient.getAddress();

	logger.info(`Setting metadata to the StorageProxy...`);
	await streamrClient.setStorageNodeMetadata(options.metadata);

	logger.info(`Updated a StorageProxy with address ${clusterId}`);
};
