import {
	CONFIG_TEST as LOGSTORE_CLIENT_CONFIG_TEST,
	LogStoreClient,
	LogStoreClientConfig,
} from '@logsn/client';
import { TEST_CONFIG } from '@streamr/network-node';
import { startTracker, Tracker } from '@streamr/network-tracker';
import {
	EthereumAddress,
	merge,
	MetricsContext,
	toEthereumAddress,
} from '@streamr/utils';
import { Wallet } from 'ethers';
import _ from 'lodash';
import {
	Stream,
	StreamMetadata,
	CONFIG_TEST as STREAMR_CLIENT_CONFIG_TEST,
	StreamrClient,
	StreamrClientConfig,
} from 'streamr-client';

import { Config } from '../src/config/config';
import {
	createLogStoreNode as createLogStoreBroker,
	LogStoreNode,
} from '../src/node';
import { LogStorePluginConfig } from '../src/plugins/logStore/LogStorePlugin';
import { StorageProxyPluginConfig } from '../src/plugins/storageProxy/StorageProxyPluginConfig';

export const STREAMR_DOCKER_DEV_HOST =
	process.env.STREAMR_DOCKER_DEV_HOST || '127.0.0.1';

export const CONTRACT_OWNER_PRIVATE_KEY =
	'0x633a182fb8975f22aaad41e9008cb49a432e9fdfef37f151e9e7c54e96258ef9';

export interface LogStoreBrokerTestConfig {
	trackerPort?: number;
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
	trackerPort,
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
				id: toEthereumAddress(new Wallet(privateKey).address),
				trackers: trackerPort
					? [
							{
								id: createEthereumAddress(trackerPort),
								ws: `ws://127.0.0.1:${trackerPort}`,
								http: `http://127.0.0.1:${trackerPort}`,
							},
					  ]
					: STREAMR_CLIENT_CONFIG_TEST.network?.trackers,
				location: {
					latitude: 60.19,
					longitude: 24.95,
					country: 'Finland',
					city: 'Helsinki',
				},
				webrtcDisallowPrivateAddresses: false,
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
						hosts: [STREAMR_DOCKER_DEV_HOST],
						datacenter: 'datacenter1',
						username: '',
						password: '',
						keyspace: db.keyspace ?? 'logstore_test',
				  }
				: {
						type: 'sqlite',
						dataPath: db.dbPath ?? ':memory:',
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

export const startTestTracker = async (port: number): Promise<Tracker> => {
	return await startTracker({
		id: createEthereumAddress(port),
		listen: {
			hostname: '127.0.0.1',
			port,
		},
		metricsContext: new MetricsContext(),
		trackerPingInterval: TEST_CONFIG.trackerPingInterval,
	});
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

export const createStreamrClient = async (
	tracker: Tracker,
	privateKey: string
): Promise<StreamrClient> => {
	const networkOptions = {
		...STREAMR_CLIENT_CONFIG_TEST?.network,
		trackers: tracker
			? [tracker.getConfigRecord()]
			: STREAMR_CLIENT_CONFIG_TEST.network?.trackers,
	} satisfies StreamrClientConfig['network'];

	const config = {
		...STREAMR_CLIENT_CONFIG_TEST,
		logLevel: 'trace',
		auth: {
			privateKey,
		},
		network: networkOptions,
	} satisfies StreamrClientConfig;

	return new StreamrClient(config);
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
