import { NodeMetadata } from '@logsn/client';
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
import {
	fastWallet,
	fetchPrivateKeyWithGas,
	KeyServer,
} from '@streamr/test-utils';
import { providers, Wallet } from 'ethers';
import { defer, firstValueFrom, switchAll, timeout } from 'rxjs';
import { switchMap } from 'rxjs/internal/operators/switchMap';
import StreamrClient, {
	Stream,
	StreamPermission,
	CONFIG_TEST as STREAMR_CONFIG_TEST,
} from 'streamr-client';

import { LogStoreNode } from '../../../../../src/node';
import {
	CONTRACT_OWNER_PRIVATE_KEY,
	createStreamrClient,
	createTestStream,
	sleep,
	startLogStoreBroker,
	startTestTracker,
} from '../../../../utils';

jest.setTimeout(60000);

const STAKE_AMOUNT = BigInt('1000000000000000000');

// There are two options to run the test managed by a value of the TRACKER_PORT constant:
// 1. TRACKER_PORT = undefined - run the test against the brokers running in dev-env and brokers run by the test script.
// 2. TRACKER_PORT = 17771 - run the test against only brokers run by the test script.
//    In this case dev-env doesn't run any brokers and there is no brokers joined the network (NodeManager.totalNodes == 0)
const TRACKER_PORT = undefined;

describe('Network Mode Programs', () => {
	const provider = new providers.JsonRpcProvider(
		STREAMR_CONFIG_TEST.contracts?.streamRegistryChainRPCs?.rpcs[0].url,
		STREAMR_CONFIG_TEST.contracts?.streamRegistryChainRPCs?.chainId
	);

	// Accounts
	let tokenAdminAccount: Wallet;
	let tokenReceiverAcoount: Wallet;
	let logStoreBrokerAccount: Wallet;
	let publisherAccount: Wallet;
	let storeOwnerAccount: Wallet;
	let storeConsumerAccount: Wallet;

	// Broker
	let logStoreBroker: LogStoreNode;

	// Clients
	let publisherClient: StreamrClient;
	let consumerClient: StreamrClient;

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
		tokenAdminAccount = new Wallet(CONTRACT_OWNER_PRIVATE_KEY, provider);
		tokenReceiverAcoount = fastWallet();
		publisherAccount = new Wallet(await fetchPrivateKeyWithGas(), provider);
		storeOwnerAccount = new Wallet(await fetchPrivateKeyWithGas(), provider);
		storeConsumerAccount = new Wallet(await fetchPrivateKeyWithGas(), provider);

		// Contracts
		nodeAdminManager = await getNodeManagerContract(tokenAdminAccount);
		tokenAdminManager = await getTokenManagerContract(tokenAdminAccount);
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

		// Listen to contract event and publish a message to a stream to process by a program
		tokenAdminManager.on('Transfer', async (...args: Array<any>) => {
			const log = args[args.length - 1];

			const message = {
				__logStoreChainId: '8997',
				__logStoreChannelId: 'evm-validate',
				address: log.address,
				blockHash: log.blockHash,
				data: log.data,
				logIndex: log.logIndex,
				topics: log.topics,
				transactionHash: log.transactionHash,
			};

			await publisherClient.publish(testStream.id, message);
		});

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

		publisherClient = await createStreamrClient(
			tracker,
			publisherAccount.privateKey
		);

		consumerClient = await createStreamrClient(
			tracker,
			storeConsumerAccount.privateKey
		);

		testStream = await createTestStream(publisherClient, module);
		// TODO: the consumer must have permission to subscribe to the stream or the strem have to be public
		await testStream.grantPermissions({
			public: true,
			permissions: [StreamPermission.SUBSCRIBE],
		});

		await prepareStakeForStoreManager(storeOwnerAccount, STAKE_AMOUNT);
		await storeManager
			.stake(testStream.id, STAKE_AMOUNT)
			.then((tx) => tx.wait());

		await prepareStakeForQueryManager(storeConsumerAccount, STAKE_AMOUNT);
		await queryManager.stake(STAKE_AMOUNT).then((tx) => tx.wait());
	});

	afterEach(async () => {
		tokenAdminManager.removeAllListeners();
		await publisherClient?.destroy();
		await consumerClient?.destroy();
		await Promise.allSettled([
			logStoreBroker?.stop(),
			nodeManager?.leave().then((tx) => tx.wait()),
			tracker?.stop(),
		]);
	});

	it('should process the message', async () => {
		const topicsMessage$ = defer(() =>
			consumerClient.getStream(nodeManager.address + '/topics')
		).pipe(
			switchMap((stream) => consumerClient.subscribe(stream)),
			switchAll(),
			timeout(15000)
		);

		await tokenAdminManager
			.transfer(tokenReceiverAcoount.address, '1000000000')
			.then((tx) => tx.wait());

		const topicsMessage = await firstValueFrom(topicsMessage$);

		expect(topicsMessage.content).toHaveProperty(
			'address',
			tokenAdminManager.address
		);
	});
});
