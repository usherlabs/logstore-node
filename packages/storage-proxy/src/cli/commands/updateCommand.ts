import { StorageNodeMetadata } from '@streamr/sdk';
import { Logger } from '@streamr/utils';
import { Command, program } from 'commander';

import { updateStorageProxy } from '../../updateStorageProxy';
import { metadataArgument } from '../arguments';

const logger = new Logger(module);

interface Options {
	privateKey: string;
	devNetwork: boolean;
}

export const updateCommand = new Command('update')
	.description('Update a StorageProxy')
	.addArgument(metadataArgument)
	.action(async (metadata: StorageNodeMetadata) => {
		try {
			const options = program.optsWithGlobals() as Options;

			await updateStorageProxy({
				...options,
				metadata,
			});
		} catch (err) {
			logger.error('Update a StorageProxy failed', { err });
			process.exit(1);
		}
	});
