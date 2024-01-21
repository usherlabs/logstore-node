import { NodeMetadata } from '@logsn/client';
import { LogStoreManager, LogStoreNodeManager, LSAN } from '@logsn/contracts';
import {
	getNodeManagerContract,
	getStoreManagerContract,
	getTokenManagerContract,
	prepareStakeForNodeManager,
	prepareStakeForStoreManager,
} from '@logsn/shared';
import { Tracker } from '@streamr/network-tracker';
import { StreamMessage } from '@streamr/protocol';
import { fetchPrivateKeyWithGas, KeyServer } from '@streamr/test-utils';
import { waitForCondition } from '@streamr/utils';
import cassandra, { Client } from 'cassandra-driver';
import { providers, Wallet } from 'ethers';
import {
	Stream,
	CONFIG_TEST as STREAMR_CLIENT_CONFIG_TEST,
	StreamrClient,
} from 'streamr-client';

import { LogStoreNode } from '../../../../src/node';
import {
	CONTRACT_OWNER_PRIVATE_KEY,
	createStreamrClient,
	createTestStream,
	sleep,
	startLogStoreBroker,
	startTestTracker,
	STREAMR_DOCKER_DEV_HOST,
} from '../../../utils';

jest.setTimeout(30000);

const contactPoints = [STREAMR_DOCKER_DEV_HOST];
const localDataCenter = 'datacenter1';
const keyspace = 'logstore_test';

const STAKE_AMOUNT = BigInt('1000000000000000000');
const HTTP_PORT = 17770;
const TRACKER_PORT = 17772;

describe('LogStoreConfig', () => {
	const provider = new providers.JsonRpcProvider(
		STREAMR_CLIENT_CONFIG_TEST.contracts?.streamRegistryChainRPCs?.rpcs[0].url,
		STREAMR_CLIENT_CONFIG_TEST.contracts?.streamRegistryChainRPCs?.chainId
	);

	// Accounts
	let logStoreBrokerAccount: Wallet;
	let publisherAccount: Wallet;
	let storeOwnerAccount: Wallet;
	let adminAccount: Wallet;

	// Broker
	let logStoreBroker: LogStoreNode;

	// Clients
	let publisherClient: StreamrClient;
	let cassandraClient: Client;

	// Contracts
	let nodeManager: LogStoreNodeManager;
	let storeManager: LogStoreManager;
	let nodeAdminManager: LogStoreNodeManager;
	let tokenAdminManager: LSAN;

	let tracker: Tracker;
	let testStream: Stream;

	beforeAll(async () => {
		// Accounts
		logStoreBrokerAccount = new Wallet(
			await fetchPrivateKeyWithGas(),
			provider
		);
		publisherAccount = new Wallet(await fetchPrivateKeyWithGas(), provider);
		storeOwnerAccount = new Wallet(await fetchPrivateKeyWithGas(), provider);
		adminAccount = new Wallet(CONTRACT_OWNER_PRIVATE_KEY, provider);

		// Contracts
		nodeManager = await getNodeManagerContract(logStoreBrokerAccount);
		storeManager = await getStoreManagerContract(storeOwnerAccount);
		nodeAdminManager = await getNodeManagerContract(adminAccount);
		tokenAdminManager = await getTokenManagerContract(adminAccount);

		// Clients
		cassandraClient = new cassandra.Client({
			contactPoints,
			localDataCenter,
			keyspace,
		});
	});

	afterAll(async () => {
		await cassandraClient?.shutdown();
		// TODO: Setup global tear-down
		await KeyServer.stopIfRunning();
	});

	beforeEach(async () => {
		tracker = await startTestTracker(TRACKER_PORT);
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
		(await nodeManager.join(STAKE_AMOUNT, JSON.stringify(nodeMetadata))).wait();

		// Wait for the granted permissions to the system stream
		await sleep(5000);

		logStoreBroker = await startLogStoreBroker({
			privateKey: logStoreBrokerAccount.privateKey,
			trackerPort: TRACKER_PORT,
			plugins: {
				logStore: {
					db: {
						type: 'cassandra',
						keyspace,
					},
				},
			},
		});

		publisherClient = await createStreamrClient(
			tracker,
			publisherAccount.privateKey
		);

		testStream = await createTestStream(publisherClient, module);

		await prepareStakeForStoreManager(storeOwnerAccount, STAKE_AMOUNT);
		(await storeManager.stake(testStream.id, STAKE_AMOUNT)).wait();
	});

	afterEach(async () => {
		await publisherClient?.destroy();
		await Promise.allSettled([
			logStoreBroker?.stop(),
			nodeManager.leave(),
			tracker?.stop(),
		]);
	});

	it('when client publishes a message, it is written to the store', async () => {
		const publishMessage = await publisherClient.publish(testStream.id, {
			foo: 'bar',
		});
		await waitForCondition(async () => {
			const result = await cassandraClient.execute(
				'SELECT COUNT(*) FROM stream_data WHERE stream_id = ? ALLOW FILTERING',
				[testStream.id]
			);
			return result.first().count > 0;
		}, 10000);
		const result = await cassandraClient.execute(
			'SELECT * FROM stream_data WHERE stream_id = ? ALLOW FILTERING',
			[testStream.id]
		);
		const storeMessage = StreamMessage.deserialize(
			JSON.parse(result.first().payload.toString())
		);
		expect(storeMessage.signature).toEqual(publishMessage.signature);
	});
});
