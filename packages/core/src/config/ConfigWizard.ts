/**
 * * The ConfigWizard is a tool for supporting the generation of a Production configuration for the Node.
 *
 * This should not be used for development purposes.
 */
import { toEthereumAddress } from '@streamr/utils';
import chalk from 'chalk';
import { Wallet } from 'ethers';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import inquirer, { Answers } from 'inquirer';
import path from 'path';

import { generateMnemonicFromAddress } from '../helpers/generateMnemonicFromAddress';
import { getDefaultFile } from './config';

export interface PrivateKeyAnswers extends Answers {
	generateOrImportPrivateKey: 'Import' | 'Generate';
	importPrivateKey?: string;
}
export interface NodeAnswers extends Answers {
	mode: 'Standalone' | 'Network';
}

export interface StorageAnswers extends Answers {
	storagePath: string;
}

const createLogger = () => {
	return {
		info: (...args: any[]) => {
			console.info(chalk.bgWhite.black(':'), ...args);
		},
		error: (...args: any[]) => {
			console.error(chalk.bgRed.black('!'), ...args);
		},
	};
};

const PRIVATE_KEY_SOURCE_GENERATE = 'Generate';
const PRIVATE_KEY_SOURCE_IMPORT = 'Import';

const PRIVATE_KEY_PROMPTS: Array<
	inquirer.Question | inquirer.ListQuestion | inquirer.CheckboxQuestion
> = [
	{
		type: 'list',
		name: 'generateOrImportPrivateKey',
		message:
			'Do you want to generate a new Ethereum private key or import an existing one?',
		choices: [PRIVATE_KEY_SOURCE_GENERATE, PRIVATE_KEY_SOURCE_IMPORT],
	},
	{
		type: 'password',
		name: 'importPrivateKey',
		message: 'Please provide the private key to import',
		when: (answers: inquirer.Answers): boolean => {
			return answers.generateOrImportPrivateKey === PRIVATE_KEY_SOURCE_IMPORT;
		},
		validate: (input: string): string | boolean => {
			try {
				new Wallet(input);
				return true;
			} catch (e: any) {
				return 'Invalid private key provided.';
			}
		},
	},
	{
		type: 'confirm',
		name: 'revealGeneratedPrivateKey',
		// eslint-disable-next-line max-len
		message:
			'We strongly recommend backing up your private key. It will be written into the config file, but would you also like to see this sensitive information on screen now?',
		default: false,
		when: (answers: inquirer.Answers): boolean => {
			return answers.generateOrImportPrivateKey === PRIVATE_KEY_SOURCE_GENERATE;
		},
	},
];

export const NODE_PROMPTS: Array<
	inquirer.Question | inquirer.ListQuestion | inquirer.CheckboxQuestion
> = [
	{
		type: 'list',
		name: 'mode',
		message: 'Which mode are you running the Node in?',
		choices: ['Standalone', 'Network'],
	},
];

export const storagePathPrompts = [
	{
		type: 'input',
		name: 'storagePath',
		message: 'Select a path to store the generated config in',
		default: getDefaultFile(),
	},
	{
		type: 'confirm',
		name: 'overwrite',
		message: (answers: inquirer.Answers): string =>
			`The selected destination ${answers.storagePath} already exists, do you want to overwrite it?`,
		default: false,
		when: (answers: inquirer.Answers): boolean =>
			existsSync(answers.storagePath),
	},
];

export const getConfig = (privateKey: string, node: NodeAnswers): any => {
	const baseConfig = {
		$schema: 'http://json-schema.org/draft-07/schema#',
		// Streamr Client
		streamrClient: {
			auth: {
				privateKey,
			},
		},
	};

	const mode = node.mode.toLowerCase();

	if (mode === 'network') {
		return Object.assign({}, baseConfig, {
			mode: {
				type: 'network',
			},
			httpServer: {
				port: 7771,
			},
			plugins: {
				logStore: {
					db: {
						type: 'cassandra',
						hosts: ['http://127.0.0.1:9042'],
						username: '',
						password: '',
						keyspace: 'logstore_1',
						datacenter: 'datacenter1',
					},
				},
			},
		});
	} else if (mode === 'standalone') {
		return Object.assign({}, baseConfig, {
			mode: {
				type: 'standalone',
				trackedStreams: [
					{
						id: '0xeb21022d952e5de09c30bfda9e6352ffa95f67be/heartbeat',
						partitions: 1,
					},
				],
			},
			httpServer: {
				port: 7774,
			},
			plugins: {
				logStore: {
					db: {
						type: 'sqlite',
						dataPath: '.data/logstore-data.db',
					},
				},
			},
		});
	}

	throw new Error('Invalid mode provided');
};

const selectStoragePath = async (): Promise<StorageAnswers> => {
	let answers;
	do {
		answers = await inquirer.prompt(storagePathPrompts);
	} while (answers.overwrite === false);
	return answers as any;
};

export const createStorageFile = async (
	config: any,
	answers: StorageAnswers
): Promise<string> => {
	const dirPath = path.dirname(answers.storagePath);
	const dirExists = existsSync(dirPath);
	if (!dirExists) {
		mkdirSync(dirPath, {
			recursive: true,
		});
	}
	writeFileSync(answers.storagePath, JSON.stringify(config, null, 4));
	chmodSync(answers.storagePath, '600');
	return answers.storagePath;
};

export const getPrivateKey = (answers: PrivateKeyAnswers): string => {
	return answers.generateOrImportPrivateKey === PRIVATE_KEY_SOURCE_IMPORT
		? answers.importPrivateKey!
		: Wallet.createRandom().privateKey;
};

export const getNodeIdentity = (
	privateKey: string
): {
	mnemonic: string;
	networkExplorerUrl: string;
} => {
	const nodeAddress = new Wallet(privateKey).address;
	const mnemonic = generateMnemonicFromAddress(toEthereumAddress(nodeAddress));
	// TODO: Network Explorer link
	const networkExplorerUrl = `https://streamr.network/network-explorer/nodes/${nodeAddress}`;
	return {
		mnemonic,
		networkExplorerUrl,
	};
};

export const startConfigWizard = async (
	getPrivateKeyAnswers = (): Promise<PrivateKeyAnswers> =>
		inquirer.prompt(PRIVATE_KEY_PROMPTS) as any,
	getNodeAnswers = (): Promise<NodeAnswers> =>
		inquirer.prompt(NODE_PROMPTS) as any,
	getStorageAnswers = selectStoragePath,
	logger = createLogger()
): Promise<void> => {
	try {
		const privateKeyAnswers = await getPrivateKeyAnswers();
		const privateKey = getPrivateKey(privateKeyAnswers);
		if (privateKeyAnswers.revealGeneratedPrivateKey) {
			logger.info(`This is your node's private key: ${privateKey}`);
		}
		const nodeAnswers = await getNodeAnswers();
		const config = getConfig(privateKey, nodeAnswers);
		const storageAnswers = await getStorageAnswers();
		const storagePath = await createStorageFile(config, storageAnswers);
		logger.info('Welcome to the LogStore Network');
		const { mnemonic, networkExplorerUrl } = getNodeIdentity(privateKey);
		if (nodeAnswers.mode.toLowerCase() === 'network') {
			logger.info('Your Node is running in Network Mode!');
			logger.info(`Your Node's generated name is ${mnemonic}.`);
			logger.info('View your node in the Network Explorer:');
			logger.info(networkExplorerUrl);
		} else {
			logger.info('Your Node is running in Standalone Mode!');
			logger.info(
				`Configure the Streams to track and subscribe to, by editing the \`trackedStreams\` property at: ${storagePath}`
			);
		}
		logger.info('You can start the logStore node now with');
		logger.info(`logstore-broker -c ${storagePath}`);
	} catch (e: any) {
		logger.error(
			'LogStore Node Config Wizard encountered an error:\n' + e.message
		);
	}
};
