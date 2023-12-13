import {
	CONFIG_TEST,
	LogStoreClient,
	Stream,
	StreamPermission,
} from '@logsn/client';
import { Tracker } from '@streamr/network-tracker';
import { fetchPrivateKeyWithGas, KeyServer } from '@streamr/test-utils';
import { providers, Wallet } from 'ethers';
import { defer, firstValueFrom, switchAll } from 'rxjs';

import { LogStoreNode } from '../../../../../src/logStoreNode';
import {
	createLogStoreClient,
	createTestStream,
	sleep,
	startLogStoreBroker,
	startTestTracker,
} from '../../../../utils';


jest.setTimeout(60000);

// There are two options to run the test managed by a value of the TRACKER_PORT constant:
// 1. TRACKER_PORT = undefined - run the test against the brokers running in dev-env and brokers run by the test script.
// 2. TRACKER_PORT = 17771 - run the test against only brokers run by the test script.
//    In this case dev-env doesn't run any brokers and there is no brokers joined the network (NodeManager.totalNodes == 0)
const TRACKER_PORT = undefined;

describe('Standalone Mode Programs', () => {
	const provider = new providers.JsonRpcProvider(
		CONFIG_TEST.contracts?.streamRegistryChainRPCs?.rpcs[0].url,
		CONFIG_TEST.contracts?.streamRegistryChainRPCs?.chainId
	);

	// Accounts
	let logStoreBrokerAccount: Wallet;
	let publisherAccount: Wallet;
	let storeConsumerAccount: Wallet;

	// Broker
	let logStoreBroker: LogStoreNode;

	// Clients
	let publisherClient: LogStoreClient;
	let consumerClient: LogStoreClient;

	let tracker: Tracker;
	let testStream: Stream;
	let topicsStream: Stream;

	beforeAll(async () => {
		logStoreBrokerAccount = new Wallet(
			await fetchPrivateKeyWithGas(),
			provider
		);

		// Accounts
		publisherAccount = new Wallet(await fetchPrivateKeyWithGas(), provider);
		storeConsumerAccount = new Wallet(await fetchPrivateKeyWithGas(), provider);

		// Contracts
	});

	afterAll(async () => {
		// TODO: Setup global tear-down
		await KeyServer.stopIfRunning();
	});

	beforeEach(async () => {
		if (TRACKER_PORT) {
			tracker = await startTestTracker(TRACKER_PORT);
		}

		// Wait for the granted permissions to the system stream
		await sleep(5000);

		publisherClient = await createLogStoreClient(
			tracker,
			publisherAccount.privateKey
		);

		consumerClient = await createLogStoreClient(
			tracker,
			storeConsumerAccount.privateKey,
			{
				nodeUrl: 'http://127.0.0.1:7171',
			}
		);

		testStream = await createTestStream(publisherClient, module);
		// to ensure Date.now() is different
		await sleep(10);
		// here we are creating from publisher client, but on a real case probably the owner of the log store node would create it
		topicsStream = await createTestStream(publisherClient, module);

		await testStream.grantPermissions({
			public: true,
			permissions: [StreamPermission.SUBSCRIBE],
		});
		await topicsStream.grantPermissions(
			{
				user: logStoreBrokerAccount.address,
				permissions: [StreamPermission.PUBLISH],
			},
			{
				public: true,
				permissions: [StreamPermission.SUBSCRIBE],
			}
		);

		logStoreBroker = await startLogStoreBroker({
			privateKey: logStoreBrokerAccount.privateKey,
			trackerPort: TRACKER_PORT,
			mode: {
				type: 'standalone',
				topicsStream: topicsStream.id,
				trackedStreams: [
					{
						id: testStream.id,
						partitions: 1,
					},
				],
			},
		});
	});

	afterEach(async () => {
		await publisherClient.destroy();
		await consumerClient.destroy();
		await Promise.allSettled([logStoreBroker?.stop(), tracker?.stop()]);
	});

	it('should process the message', async () => {
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
			consumerClient.subscribe(topicsStream)
		).pipe(switchAll());

		const [topicsMessage] = await Promise.all([
			firstValueFrom(topicsMessage$),
			publisherClient.publish(testStream.id, message),
		]);

		expect(topicsMessage.content).toHaveProperty('address', message.address);
	});
});
