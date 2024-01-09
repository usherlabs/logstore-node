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
import { fetchPrivateKeyWithGas, KeyServer } from '@streamr/test-utils';
import { providers, Wallet } from 'ethers';
import { defer, firstValueFrom, switchAll } from 'rxjs';
import { switchMap } from 'rxjs/internal/operators/switchMap';
import StreamrClient, {
	Stream,
	StreamPermission,
	CONFIG_TEST as STREAMR_CONFIG_TEST,
} from 'streamr-client';

import { LogStoreNode } from '../../../../../src/node';
import {
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
	let adminAccount: Wallet;
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
		adminAccount = new Wallet(
			process.env.CONTRACT_OWNER_PRIVATE_KEY!,
			provider
		);
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
		(await nodeManager.join(STAKE_AMOUNT, JSON.stringify(nodeMetadata))).wait();

		// Wait for the granted permissions to the system stream
		await sleep(5000);

		logStoreBroker = await startLogStoreBroker({
			privateKey: logStoreBrokerAccount.privateKey,
			trackerPort: TRACKER_PORT,
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

		await prepareStakeForStoreManager(storeOwnerAccount, STAKE_AMOUNT);
		(await storeManager.stake(testStream.id, STAKE_AMOUNT)).wait();

		await prepareStakeForQueryManager(storeConsumerAccount, STAKE_AMOUNT);
		(await queryManager.stake(STAKE_AMOUNT)).wait();
	});

	afterEach(async () => {
		await publisherClient.destroy();
		await consumerClient.destroy();
		await Promise.allSettled([
			logStoreBroker?.stop(),
			nodeManager.leave(),
			tracker?.stop(),
		]);
	});

	it('should process the message', async () => {
		// TODO: the consumer must have permission to subscribe to the stream or the strem have to be public
		await testStream.grantPermissions({
			public: true,
			permissions: [StreamPermission.SUBSCRIBE],
		});

		const message = {
			__logStoreChainId: '137',
			__logStoreChannelId: 'evm-validate',
			address: '0x365Bdc64E2aDb50E43E56a53B7Cc438d48D0f0DD',
			blockHash:
				'0xed6afdb35db598ee08623a9564a5fab3a6e64fea6718c380e7c7342911a4d1a4',
			data: '0x0000000000000000000000000000000000000000000000000000000000000001',
			logIndex: 372,
			topics: [
				'0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
				'0x000000000000000000000000aeefa929280b17c81803727dcfb62c5fad511f31',
				'0x000000000000000000000000c6d330e5b7deb31824b837aa77771178bd8e6713',
			],
			transactionHash:
				'0x4b4b1b1b3c89ac7833926e410c7d39f976fc7e47125d1326d715846f7acf06ef',
		};

		const topicsMessage$ = defer(() =>
			consumerClient.getStream(nodeManager.address + '/topics')
		).pipe(
			switchMap((stream) => consumerClient.subscribe(stream)),
			switchAll()
		);

		const [topicsMessage] = await Promise.all([
			firstValueFrom(topicsMessage$),
			publisherClient.publish(testStream.id, message),
		]);

		expect(topicsMessage.content).toHaveProperty('address', message.address);
	});
});
