import { Command } from 'commander';

import { createLogStoreNode } from '../logStoreNode';
import { overrideConfigToEnvVarsIfGiven } from '../config/config';
import { readConfigAndMigrateIfNeeded } from '../config/migration';
import { configOption } from './options';

export const startCommand = new Command('start')
	.description('Start the LogStore node')
	.addOption(configOption)
	.action(async (args) => {
		try {
			const config = readConfigAndMigrateIfNeeded(args.config);
			overrideConfigToEnvVarsIfGiven(config);
			const node = await createLogStoreNode(config);
			await node.start();
		} catch (err) {
			console.error(err);
			process.exit(1);
		}
	});
