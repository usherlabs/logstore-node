import { LogStoreClient, NodeMetadata } from '@logsn/client';
import {
	LogStoreManager,
	LogStoreNodeManager,
	LogStoreQueryManager,
	LSAN as LogStoreTokenManager,
} from '@logsn/contracts';
import {
	getNodeManagerContract,
	getQueryManagerContract,
	getStoreManagerContract,
	getTokenManagerContract,
	prepareStakeForNodeManager,
	prepareStakeForQueryManager,
	prepareStakeForStoreManager,
} from '@logsn/shared';
import { Stream, StreamPermission, StreamrClient } from '@streamr/sdk';
import { fetchPrivateKeyWithGas, KeyServer } from '@streamr/test-utils';
import { Wallet } from 'ethers';

import { LogStoreNode } from '../../../src/node';
import {
	CONTRACT_OWNER_PRIVATE_KEY,
	createLogStoreClient,
	createStreamrClient,
	createTestStream,
	getProvider,
	sleep,
	startLogStoreBroker,
} from '../../utils';

jest.setTimeout(60000);

const STAKE_AMOUNT = BigInt('1000000000000000000');

describe('Network Mode Queries', () => {
	const provider = getProvider();

	// Accounts
	let adminAccount: Wallet;
	let logStoreBrokerAccount: Wallet;
	let publisherAccount: Wallet;
	let storeOwnerAccount: Wallet;
	let storeConsumerAccount: Wallet;

	// Broker
	let logStoreBroker: LogStoreNode;

	// Clients
	let publisherStreamrClient: StreamrClient;
	let publisherLogStoreClient: LogStoreClient;
	let consumerStreamrClient: StreamrClient;
	let consumerLogStoreClient: LogStoreClient;

	// Contracts
	let nodeAdminManager: LogStoreNodeManager;
	let tokenAdminManager: LogStoreTokenManager;
	let nodeManager: LogStoreNodeManager;
	let storeManager: LogStoreManager;
	let queryManager: LogStoreQueryManager;

	let testStream: Stream;

	beforeAll(async () => {
		logStoreBrokerAccount = new Wallet(
			await fetchPrivateKeyWithGas(),
			provider
		);

		// Accounts
		adminAccount = new Wallet(CONTRACT_OWNER_PRIVATE_KEY, provider);
		publisherAccount = new Wallet(await fetchPrivateKeyWithGas(), provider);
		storeOwnerAccount = new Wallet(await fetchPrivateKeyWithGas(), provider);
		storeConsumerAccount = new Wallet(await fetchPrivateKeyWithGas(), provider);

		// Contracts
		nodeAdminManager = await getNodeManagerContract(adminAccount);
		tokenAdminManager = await getTokenManagerContract(adminAccount);
		nodeManager = await getNodeManagerContract(logStoreBrokerAccount);
		storeManager = await getStoreManagerContract(storeOwnerAccount);
		queryManager = await getQueryManagerContract(storeConsumerAccount);
	});

	afterAll(async () => {
		// TODO: Setup global tear-down
		await KeyServer.stopIfRunning();
	});

	beforeEach(async () => {
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

		// Wait for the granted permissions to the system stream
		await sleep(5000);

		logStoreBroker = await startLogStoreBroker({
			privateKey: logStoreBrokerAccount.privateKey,
			plugins: {
				logStore: {
					db: {
						type: 'cassandra',
					},
				},
			},
		});

		publisherStreamrClient = await createStreamrClient(
			publisherAccount.privateKey
		);

		publisherLogStoreClient = await createLogStoreClient(
			publisherStreamrClient
		);

		consumerStreamrClient = await createStreamrClient(
			storeConsumerAccount.privateKey
		);
		consumerLogStoreClient = await createLogStoreClient(consumerStreamrClient);

		testStream = await createTestStream(publisherStreamrClient, module);

		// debug easier
		// @ts-ignore
		global.streamId = testStream.id;

		await prepareStakeForStoreManager(storeOwnerAccount, STAKE_AMOUNT);
		await storeManager
			.stake(testStream.id, STAKE_AMOUNT)
			.then((tx) => tx.wait());

		await prepareStakeForQueryManager(storeConsumerAccount, STAKE_AMOUNT);
		await queryManager.stake(STAKE_AMOUNT).then((tx) => tx.wait());
	});

	afterEach(async () => {
		await publisherStreamrClient?.destroy();
		await consumerStreamrClient?.destroy();
		publisherLogStoreClient?.destroy();
		consumerLogStoreClient?.destroy();
		await Promise.allSettled([
			logStoreBroker?.stop(),
			nodeManager?.leave().then((tx) => tx.wait()),
		]);
	});

	it('when client publishes a message, it is written to the store', async () => {
		// TODO: the consumer must have permission to subscribe to the stream or the strem have to be public
		await testStream.grantPermissions({
			user: await consumerStreamrClient.getAddress(),
			permissions: [StreamPermission.SUBSCRIBE],
		});
		// await testStream.grantPermissions({
		// 	public: true,
		// 	permissions: [StreamPermission.SUBSCRIBE],
		// });

		await publisherStreamrClient.publish(testStream.id, {
			foo: 'bar 1',
		});
		await publisherStreamrClient.publish(testStream.id, {
			foo: 'bar 2',
		});
		await publisherStreamrClient.publish(testStream.id, {
			foo: 'bar 3',
		});

		await sleep(5000);

		const messages = [];

		const messageStream = await consumerLogStoreClient.query(testStream.id, {
			last: 2,
		});

		for await (const message of messageStream) {
			const { content } = message;
			messages.push({ content });
		}

		expect(messages).toHaveLength(2);
	});
});
