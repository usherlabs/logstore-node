import { NodeMetadata } from '@logsn/client';
import {
	LogStoreNodeManager,
	LogStoreQueryManager,
	LSAN as LogStoreTokenManager,
} from '@logsn/contracts';
import {
	getNodeManagerContract,
	getQueryManagerContract,
	getTokenManagerContract,
	prepareStakeForNodeManager,
	prepareStakeForQueryManager,
} from '@logsn/shared';
import {
	addNodeToStorageProxy,
	createStorageProxy,
	dropStorageProxy,
	removeNodeFromStorageProxy,
} from '@logsn/storage-proxy';
import { Tracker } from '@streamr/network-tracker';
import { KeyServer } from '@streamr/test-utils';
import { toEthereumAddress } from '@streamr/utils';
import { providers, Wallet } from 'ethers';
import StreamrClient, {
	Stream,
	StreamPermission,
	CONFIG_TEST as STREAMR_CLIENT_CONFIG_TEST,
} from 'streamr-client';

import { LogStoreNode } from '../../../../src/node';
import {
	CONTRACT_OWNER_PRIVATE_KEY,
	createStreamrClient,
	createTestStream,
	fetchWalletsWithGas,
	publishTestMessages,
	startLogStoreBroker,
	startTestTracker,
} from '../../../utils';

const STAKE_AMOUNT = BigInt('1000000000000000000');

// There are two options to run the test managed by a value of the TRACKER_PORT constant:
// 1. TRACKER_PORT = undefined - run the test against the brokers running in dev-env and brokers run by the test script.
// 2. TRACKER_PORT = 17771 - run the test against only brokers run by the test script.
//    In this case dev-env doesn't run any brokers and there is no brokers joined the network (NodeManager.totalNodes == 0)
const TRACKER_PORT = undefined;

describe('StorageProxy management', () => {
	const provider = new providers.JsonRpcProvider(
		STREAMR_CLIENT_CONFIG_TEST.contracts?.streamRegistryChainRPCs?.rpcs[0].url,
		STREAMR_CLIENT_CONFIG_TEST.contracts?.streamRegistryChainRPCs?.chainId
	);

	// Accounts
	let adminAccount: Wallet;
	let storageProxyAccount: Wallet;
	let logStoreBrokerAccount: Wallet;
	let streamOwnerAccount: Wallet;
	// let storeConsumerAccount: Wallet;

	// Broker
	let logStoreBroker: LogStoreNode;

	// Clients
	let streamOwnerClient: StreamrClient;
	// let consumerStreamrClient: StreamrClient;

	// Contracts
	let nodeAdminManager: LogStoreNodeManager;
	let tokenAdminManager: LogStoreTokenManager;
	let nodeManager: LogStoreNodeManager;
	let queryManager: LogStoreQueryManager;

	let tracker: Tracker;
	let testStream: Stream;

	beforeAll(async () => {
		// Accounts
		adminAccount = new Wallet(CONTRACT_OWNER_PRIVATE_KEY, provider);
		[storageProxyAccount, logStoreBrokerAccount, streamOwnerAccount] =
			await fetchWalletsWithGas(provider, 3);

		// Contracts
		nodeAdminManager = await getNodeManagerContract(adminAccount);
		tokenAdminManager = await getTokenManagerContract(adminAccount);
		queryManager = await getQueryManagerContract(logStoreBrokerAccount);
		nodeManager = await getNodeManagerContract(logStoreBrokerAccount);

		if (TRACKER_PORT) {
			tracker = await startTestTracker(TRACKER_PORT);
		}
	});

	afterAll(async () => {
		await streamOwnerClient?.destroy();
		await tracker?.stop();
		await logStoreBroker?.stop();
		// TODO: Setup global tear-down
		await KeyServer.stopIfRunning();
	});

	it(
		'Creates a StorageProxy',
		async () => {
			await createStorageProxy({
				privateKey: storageProxyAccount.privateKey,
				metadata: { http: 'http://localhost:7171' },
				devNetwork: true,
			});
		},
		30 * 1000
	);

	it(
		'Joins a Node to a StorageProxy',
		async () => {
			await addNodeToStorageProxy({
				privateKey: storageProxyAccount.privateKey,
				node: toEthereumAddress(logStoreBrokerAccount.address),
				devNetwork: true,
			});

			const nodeMetadata: NodeMetadata = {
				http: 'http://127.0.0.1:7171',
			};

			await nodeAdminManager
				.whitelistApproveNode(logStoreBrokerAccount.address)
				.then((tx) => tx.wait());
			await tokenAdminManager
				.addWhitelist(logStoreBrokerAccount.address, nodeManager.address)
				.then((tx) => tx.wait());

			await prepareStakeForNodeManager(logStoreBrokerAccount, STAKE_AMOUNT);
			await (
				await nodeManager.join(STAKE_AMOUNT, JSON.stringify(nodeMetadata))
			).wait();

			await prepareStakeForQueryManager(logStoreBrokerAccount, STAKE_AMOUNT);
			await (await queryManager.stake(STAKE_AMOUNT)).wait();
		},
		30 * 1000
	);

	it('Starts a Node with LogStore and StorageProxy plugins', async () => {
		logStoreBroker = await startLogStoreBroker({
			privateKey: logStoreBrokerAccount.privateKey,
			trackerPort: TRACKER_PORT,
			plugins: {
				logStore: {
					db: { type: 'cassandra' },
				},
				storageProxy: {
					clusterAddress: storageProxyAccount.address,
				},
			},
		});
	});

	it(
		'Creates a test stream and adds it to a StorageProxy',
		async () => {
			streamOwnerClient = await createStreamrClient(
				tracker,
				streamOwnerAccount.privateKey
			);

			testStream = await createTestStream(streamOwnerClient, module);
			await testStream.grantPermissions({
				public: true,
				permissions: [StreamPermission.SUBSCRIBE],
			});

			await testStream.addToStorageNode(storageProxyAccount.address);
		},
		30 * 1000
	);

	it(
		'Publishes and resends messages',
		async () => {
			const publishedMessages = await publishTestMessages(
				streamOwnerClient,
				testStream,
				2
			);

			const messages = [];
			const messageStream = await streamOwnerClient.resend(testStream.id, {
				last: 2,
			});

			for await (const message of messageStream) {
				const { content } = message;
				messages.push({ content });
			}

			expect(messages.length).toEqual(2);
			expect(messages[0].content).toEqual(publishedMessages[0].originalCOntent);
			expect(messages[1].content).toEqual(publishedMessages[1].originalCOntent);
		},
		10 * 1000
	);

	it(
		'Removes a stream from a StorageProxy',
		async () => {
			await testStream.removeFromStorageNode(storageProxyAccount.address);
		},
		30 * 1000
	);

	it(
		'Deletes the test stream',
		async () => {
			await testStream.delete();
		},
		30 * 1000
	);

	it(
		'Removes a Node from a StorageProxy',
		async () => {
			await removeNodeFromStorageProxy({
				privateKey: storageProxyAccount.privateKey,
				node: toEthereumAddress(logStoreBrokerAccount.address),
				devNetwork: true,
			});
		},
		30 * 1000
	);

	it(
		'Drops s StorageProxy',
		async () => {
			await dropStorageProxy({
				privateKey: storageProxyAccount.privateKey,
				devNetwork: true,
			});
		},
		30 * 1000
	);
});
