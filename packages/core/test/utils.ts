import { JsonRpcProvider, Provider } from '@ethersproject/providers';
import {
	CONFIG_TEST as LOGSTORE_CLIENT_CONFIG_TEST,
	LogStoreClient,
	LogStoreClientConfig,
} from '@logsn/client';
import { config as CHAIN_CONFIG } from '@streamr/config';
import {
	Message,
	Stream,
	StreamMetadata,
	CONFIG_TEST as STREAMR_CLIENT_CONFIG_TEST,
	StreamrClient,
	StreamrClientConfig,
} from '@streamr/sdk';
import { fetchPrivateKeyWithGas } from '@streamr/test-utils';
import { EthereumAddress, merge, toEthereumAddress } from '@streamr/utils';
import { providers, Wallet } from 'ethers';
import _ from 'lodash';

import { Config } from '../src/config/config';
import {
	createLogStoreNode as createLogStoreBroker,
	LogStoreNode,
} from '../src/node';
import { LogStorePluginConfig } from '../src/plugins/logStore/LogStorePlugin';
import { StorageProxyPluginConfig } from '../src/plugins/storageProxy/StorageProxyPluginConfig';

export const STREAMR_DOCKER_DEV_HOST =
	process.env.STREAMR_DOCKER_DEV_HOST || '127.0.0.1';

export const TEST_CHAIN_CONFIG = CHAIN_CONFIG.dev2;

export const CONTRACT_OWNER_PRIVATE_KEY =
	'0x633a182fb8975f22aaad41e9008cb49a432e9fdfef37f151e9e7c54e96258ef9';

export interface LogStoreBrokerTestConfig {
	privateKey: string;
	plugins: {
		logStore?: LogStorePluginTestConfig;
		storageProxy?: StorageProxyPluginTestConfig;
	} & Record<string, unknown>;
	httpServerPort?: number;
	mode?: Config['mode'];
}

export interface LogStorePluginTestConfig {
	db:
		| {
				type: 'cassandra';
				keyspace?: string;
		  }
		| {
				type: 'sqlite';
				dbPath?: string;
		  };
	refreshInterval?: number;
}

export interface StorageProxyPluginTestConfig {
	clusterAddress: string;
}

export const formLogStoreNetworkBrokerConfig = ({
	privateKey,
	plugins,
	httpServerPort = 7171,
	mode,
}: LogStoreBrokerTestConfig): Config => {
	const config: Config = {
		logStoreClient: {
			...LOGSTORE_CLIENT_CONFIG_TEST,
		},
		streamrClient: {
			...STREAMR_CLIENT_CONFIG_TEST,
			logLevel: 'trace',
			auth: {
				privateKey,
			},
			network: {
				...STREAMR_CLIENT_CONFIG_TEST.network,
				node: {
					id: toEthereumAddress(new Wallet(privateKey).address),
				},
			},
		},
		plugins: {},
		mode,
		httpServer: {
			port: httpServerPort,
		},
	};

	if (plugins.logStore) {
		config.plugins!.logStore = formLogStorePluginConfig(plugins.logStore);
	}

	if (plugins.storageProxy) {
		config.plugins!.storageProxy = formStorageProxyPluginConfig(
			plugins.storageProxy
		);
	}

	return config;
};

export const formLogStorePluginConfig = ({
	db,
	refreshInterval = 0,
}: LogStorePluginTestConfig): Partial<LogStorePluginConfig> => {
	return {
		logStoreConfig: {
			refreshInterval,
		},
		db:
			db.type === 'cassandra'
				? {
						type: 'cassandra',
						hosts: ['10.200.10.1'],
						datacenter: 'datacenter1',
						username: '',
						password: '',
						keyspace: db.keyspace ?? 'logstore_test',
					}
				: {
						type: 'sqlite',
						dataPath: db.dbPath ?? ':memory:',
					},
		programs: {
			chainRpcUrls: {
				'31337': 'http://10.200.10.1:8547',
			},
		},
	};
};

export const formStorageProxyPluginConfig = ({
	clusterAddress,
}: StorageProxyPluginTestConfig): Partial<StorageProxyPluginConfig> => {
	return {
		storageConfig: {
			refreshInterval: 10000,
			storeStakeAmount: '1000000000',
		},
		cluster: {
			clusterAddress: toEthereumAddress(clusterAddress),
		},
	};
};

export const startLogStoreBroker = async (
	testConfig: LogStoreBrokerTestConfig
): Promise<LogStoreNode> => {
	const broker = await createLogStoreBroker(
		formLogStoreNetworkBrokerConfig(testConfig)
	);
	await broker.start();
	return broker;
};

export const createEthereumAddress = (id: number): EthereumAddress => {
	return toEthereumAddress('0x' + _.padEnd(String(id), 40, '0'));
};

export const createStreamrClient = (
	privateKey: string,
	clientOptions?: StreamrClientConfig
): StreamrClient => {
	const opts = merge(
		STREAMR_CLIENT_CONFIG_TEST,
		{
			auth: {
				privateKey,
			},
			network: {
				controlLayer: STREAMR_CLIENT_CONFIG_TEST.network!.controlLayer,
				node: merge(
					STREAMR_CLIENT_CONFIG_TEST.network!.node,
					clientOptions?.network?.node
				),
			},
		},
		clientOptions
	);
	return new StreamrClient(opts);
};

export const createLogStoreClient = async (
	streamrClient: StreamrClient,
	clientOptions?: LogStoreClientConfig
): Promise<LogStoreClient> => {
	const config = merge<LogStoreClientConfig>(
		{ logLevel: 'trace' },
		LOGSTORE_CLIENT_CONFIG_TEST,
		clientOptions
	);
	return new LogStoreClient(streamrClient, config);
};

export const getTestName = (module: NodeModule): string => {
	const fileNamePattern = new RegExp('.*/(.*).test\\...');
	const groups = module.filename.match(fileNamePattern);
	return groups !== null ? groups[1] : module.filename;
};

export const createTestStream = async (
	streamrClient: StreamrClient,
	module: NodeModule,
	props?: Partial<StreamMetadata>
): Promise<Stream> => {
	const id =
		(await streamrClient.getAddress()) +
		'/test/' +
		getTestName(module) +
		'/' +
		Date.now();
	const stream = await streamrClient.createStream({
		id,
		...props,
	});
	return stream;
};

export async function sleep(ms = 0): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

export const fetchWalletsWithGas = async (
	provider: providers.Provider,
	number: number
): Promise<Wallet[]> => {
	return await Promise.all(
		[...Array(number)].map(
			async () => new Wallet(await fetchPrivateKeyWithGas(), provider)
		)
	);
};

export const publishTestMessages = async (
	client: StreamrClient,
	stream: Stream,
	number: number,
	interval: number = 200,
	finalDelay: number = 5000
) => {
	const messages: (Message & { originalContent: string })[] = [];

	for (let i = 0; i < number; i++) {
		const originalContent = `Test Message ${i}`;
		const message = await client.publish(stream.id, originalContent);

		messages.push({ ...message, originalContent });

		await sleep(interval);
	}

	await sleep(finalDelay);

	return messages;
};

export function getProvider(): Provider {
	return new JsonRpcProvider(TEST_CHAIN_CONFIG.rpcEndpoints[0].url);
}
