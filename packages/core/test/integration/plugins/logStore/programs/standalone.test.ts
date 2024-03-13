import { LSAN } from '@logsn/contracts';
import { getTokenManagerContract } from '@logsn/shared';
import { Tracker } from '@streamr/network-tracker';
import {
	fastWallet,
	fetchPrivateKeyWithGas,
	KeyServer,
} from '@streamr/test-utils';
import { providers, Wallet } from 'ethers';
import { defer, firstValueFrom, switchAll, timeout } from 'rxjs';
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

// There are two options to run the test managed by a value of the TRACKER_PORT constant:
// 1. TRACKER_PORT = undefined - run the test against the brokers running in dev-env and brokers run by the test script.
// 2. TRACKER_PORT = 17771 - run the test against only brokers run by the test script.
//    In this case dev-env doesn't run any brokers and there is no brokers joined the network (NodeManager.totalNodes == 0)
const TRACKER_PORT = undefined;

describe('Standalone Mode Programs', () => {
	const provider = new providers.JsonRpcProvider(
		STREAMR_CONFIG_TEST.contracts?.streamRegistryChainRPCs?.rpcs[0].url,
		STREAMR_CONFIG_TEST.contracts?.streamRegistryChainRPCs?.chainId
	);

	// Accounts
	let tokenSenderAccount: Wallet;
	let tokenReceiverAcoount: Wallet;
	let logStoreBrokerAccount: Wallet;
	let publisherAccount: Wallet;
	let storeConsumerAccount: Wallet;

	// Broker
	let logStoreBroker: LogStoreNode;

	// Clients
	let publisherStreamrClient: StreamrClient;
	let consumerStreamrClient: StreamrClient;

	// Contracts
	let tokenAdminManager: LSAN;

	let tracker: Tracker;
	let testStream: Stream;
	let topicsStream: Stream;

	beforeAll(async () => {
		logStoreBrokerAccount = new Wallet(
			await fetchPrivateKeyWithGas(),
			provider
		);

		// Accounts
		tokenSenderAccount = new Wallet(await fetchPrivateKeyWithGas(), provider);
		tokenReceiverAcoount = fastWallet();
		publisherAccount = new Wallet(await fetchPrivateKeyWithGas(), provider);
		storeConsumerAccount = new Wallet(await fetchPrivateKeyWithGas(), provider);

		// Contracts
		tokenAdminManager = await getTokenManagerContract(tokenSenderAccount);
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

		publisherStreamrClient = await createStreamrClient(
			tracker,
			publisherAccount.privateKey
		);

		consumerStreamrClient = await createStreamrClient(
			tracker,
			storeConsumerAccount.privateKey
		);

		testStream = await createTestStream(publisherStreamrClient, module);

		await testStream.grantPermissions({
			public: true,
			permissions: [StreamPermission.SUBSCRIBE],
		});

		// to ensure Date.now() is different
		await sleep(10);

		// here we are creating from publisher client, but on a real case probably the owner of the log store node would create it
		topicsStream = await createTestStream(publisherStreamrClient, module);

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

			await publisherStreamrClient.publish(testStream.id, message);
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
		tokenAdminManager?.removeAllListeners();
		await publisherStreamrClient?.destroy();
		await consumerStreamrClient?.destroy();
		await Promise.allSettled([logStoreBroker?.stop(), tracker?.stop()]);
	});

	it('should process the message', async () => {
		const topicsMessage$ = defer(() =>
			consumerStreamrClient.subscribe(topicsStream)
		).pipe(switchAll(), timeout(15000));

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
