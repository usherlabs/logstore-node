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
import StreamrClient, { Stream, StreamPermission } from '@streamr/sdk';
import { KeyServer } from '@streamr/test-utils';
import { toEthereumAddress } from '@streamr/utils';
import { Wallet } from 'ethers';

import { LogStoreNode } from '../../../../src/node';
import {
	CONTRACT_OWNER_PRIVATE_KEY,
	createStreamrClient,
	createTestStream,
	fetchWalletsWithGas,
	getProvider,
	publishTestMessages,
	startLogStoreBroker,
} from '../../../utils';

const STAKE_AMOUNT = BigInt('1000000000000000000');

describe('StorageProxy management', () => {
	const provider = getProvider();

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
	});

	afterAll(async () => {
		await streamOwnerClient?.destroy();
		await logStoreBroker?.stop();
		// TODO: Setup global tear-down
		await KeyServer.stopIfRunning();
	});

	it(
		'Creates a StorageProxy',
		async () => {
			await createStorageProxy({
				privateKey: storageProxyAccount.privateKey,
				metadata: { urls: ['http://10.200.10.1:7171'] },
				devNetwork: true,
			});
		},
		30 * 1000
	);

	it(
		'Adds a Node to a StorageProxy',
		async () => {
			await addNodeToStorageProxy({
				privateKey: storageProxyAccount.privateKey,
				node: toEthereumAddress(logStoreBrokerAccount.address),
				devNetwork: true,
			});

			const nodeMetadata: NodeMetadata = {
				http: 'http://10.200.10.1:7171',
			};

			await nodeAdminManager
				.whitelistApproveNode(logStoreBrokerAccount.address)
				.then((tx) => tx.wait());
			await tokenAdminManager
				.addWhitelist(logStoreBrokerAccount.address, nodeManager.address)
				.then((tx) => tx.wait());

			await prepareStakeForNodeManager(logStoreBrokerAccount, STAKE_AMOUNT);

			await nodeManager
				.join(STAKE_AMOUNT, JSON.stringify(nodeMetadata))
				.then((tx) => tx.wait());

			await prepareStakeForQueryManager(logStoreBrokerAccount, STAKE_AMOUNT);
			await queryManager.stake(STAKE_AMOUNT).then((tx) => tx.wait());
		},
		30 * 1000
	);

	it('Starts a Node with LogStore and StorageProxy plugins', async () => {
		logStoreBroker = await startLogStoreBroker({
			privateKey: logStoreBrokerAccount.privateKey,
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
			expect(messages[0].content).toEqual(publishedMessages[0].originalContent);
			expect(messages[1].content).toEqual(publishedMessages[1].originalContent);
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

			await nodeManager.leave().then((tx) => tx.wait());
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
