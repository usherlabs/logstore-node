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
import { Tracker } from '@streamr/network-tracker';
import { fetchPrivateKeyWithGas, KeyServer } from '@streamr/test-utils';
import { waitForCondition } from '@streamr/utils';
import { providers, Wallet } from 'ethers';
import StreamrClient, {
	Stream,
	StreamPermission,
	CONFIG_TEST as STREAMR_CLIENT_CONFIG_TEST,
} from 'streamr-client';

import { LogStoreNode } from '../../../src/node';
import {
	CONTRACT_OWNER_PRIVATE_KEY,
	createLogStoreClient,
	createStreamrClient,
	createTestStream,
	sleep,
	startLogStoreBroker,
	startTestTracker,
} from '../../utils';

jest.setTimeout(60000);

const STAKE_AMOUNT = BigInt('1000000000000000000');

// There are two options to run the test managed by a value of the TRACKER_PORT constant:
// 1. TRACKER_PORT = undefined - run the test against the brokers running in dev-env and brokers run by the test script.
// 2. TRACKER_PORT = 17771 - run the test against only brokers run by the test script.
//    In this case dev-env doesn't run any brokers and there is no brokers joined the network (NodeManager.totalNodes == 0)
const TRACKER_PORT = undefined;

describe('Network Mode Queries', () => {
	const provider = new providers.JsonRpcProvider(
		STREAMR_CLIENT_CONFIG_TEST.contracts?.streamRegistryChainRPCs?.rpcs[0].url,
		STREAMR_CLIENT_CONFIG_TEST.contracts?.streamRegistryChainRPCs?.chainId
	);

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

	let tracker: Tracker;
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
		if (TRACKER_PORT) {
			tracker = await startTestTracker(TRACKER_PORT);
		}
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
		await nodeManager
			.join(STAKE_AMOUNT, JSON.stringify(nodeMetadata))
			.then((tx) => tx.wait());

		// Wait for the granted permissions to the system stream
		await sleep(5000);

		logStoreBroker = await startLogStoreBroker({
			privateKey: logStoreBrokerAccount.privateKey,
			trackerPort: TRACKER_PORT,
			plugins: {
				logStore: {
					db: {
						type: 'cassandra',
					},
				},
			},
		});

		publisherStreamrClient = await createStreamrClient(
			tracker,
			publisherAccount.privateKey
		);

		publisherLogStoreClient = await createLogStoreClient(
			publisherStreamrClient
		);

		consumerStreamrClient = await createStreamrClient(
			tracker,
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
			tracker?.stop(),
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

		await waitForCondition(async () => {
			return messages.length === 2;
		});
	});
});
