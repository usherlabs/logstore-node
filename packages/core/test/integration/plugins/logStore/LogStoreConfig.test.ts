import { NodeMetadata } from '@logsn/client';
import { LogStoreManager, LogStoreNodeManager, LSAN } from '@logsn/contracts';
import {
	getNodeManagerContract,
	getStoreManagerContract,
	getTokenManagerContract,
	prepareStakeForNodeManager,
	prepareStakeForStoreManager,
} from '@logsn/shared';
import { Stream, StreamrClient } from '@streamr/sdk';
import { fetchPrivateKeyWithGas, KeyServer } from '@streamr/test-utils';
import { convertBytesToStreamMessage } from '@streamr/trackerless-network';
import { waitForCondition } from '@streamr/utils';
import cassandra, { Client } from 'cassandra-driver';
import { Wallet } from 'ethers';

import { LogStoreNode } from '../../../../src/node';
import {
	CONTRACT_OWNER_PRIVATE_KEY,
	createStreamrClient,
	createTestStream,
	getProvider,
	sleep,
	startLogStoreBroker,
	STREAMR_DOCKER_DEV_HOST,
} from '../../../utils';

jest.setTimeout(60000);

const contactPoints = [STREAMR_DOCKER_DEV_HOST];
const localDataCenter = 'datacenter1';
const keyspace = 'logstore_test';

const STAKE_AMOUNT = BigInt('1000000000000000000');

describe('LogStoreConfig', () => {
	const provider = getProvider();

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
						keyspace,
					},
				},
			},
			mode: {
				type: 'network',
			},
		});

		publisherClient = await createStreamrClient(publisherAccount.privateKey);

		testStream = await createTestStream(publisherClient, module);

		await prepareStakeForStoreManager(storeOwnerAccount, STAKE_AMOUNT);
		await storeManager
			.stake(testStream.id, STAKE_AMOUNT)
			.then((tx) => tx.wait());
	});

	afterEach(async () => {
		await publisherClient?.destroy();
		await Promise.allSettled([
			logStoreBroker?.stop(),
			nodeManager?.leave().then((tx) => tx.wait()),
		]);
	});

	it('when client publishes a message, it is written to the store', async () => {
		const publishedMessage = await publisherClient.publish(testStream.id, {
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
		const storedMessage = convertBytesToStreamMessage(result.first().payload);
		expect(storedMessage.signature).toEqual(publishedMessage.signature);
	});
});
