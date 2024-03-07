import { LogStoreClient } from '@logsn/client';
import { Tracker } from '@streamr/network-tracker';
import { fetchPrivateKeyWithGas, KeyServer } from '@streamr/test-utils';
import { waitForCondition } from '@streamr/utils';
import { providers, Wallet } from 'ethers';
import fetch from 'node-fetch';
import StreamrClient, {
	Stream,
	StreamPermission,
	CONFIG_TEST as STREAMR_CONFIG_TEST,
} from 'streamr-client';

import { LogStoreNode } from '../../../src/node';
import { WEBSERVER_PATHS } from '../../../src/plugins/logStore/subprocess/constants';
import {
	createLogStoreClient,
	createStreamrClient,
	createTestStream,
	sleep,
	startLogStoreBroker,
	startTestTracker,
	TEST_WEBSERVER_PATH,
} from '../../utils';

jest.setTimeout(60000);

// There are two options to run the test managed by a value of the TRACKER_PORT constant:
// 1. TRACKER_PORT = undefined - run the test against the brokers running in dev-env and brokers run by the test script.
// 2. TRACKER_PORT = 17771 - run the test against only brokers run by the test script.
//    In this case dev-env doesn't run any brokers and there is no brokers joined the network (NodeManager.totalNodes == 0)
const TRACKER_PORT = undefined;

describe('Standalone Mode Queries', () => {
	jest.spyOn(WEBSERVER_PATHS, 'prover').mockReturnValue(TEST_WEBSERVER_PATH);

	const provider = new providers.JsonRpcProvider(
		STREAMR_CONFIG_TEST.contracts?.streamRegistryChainRPCs?.rpcs[0].url,
		STREAMR_CONFIG_TEST.contracts?.streamRegistryChainRPCs?.chainId
	);

	// Accounts
	let logStoreBrokerAccount: Wallet;
	let publisherAccount: Wallet;
	let storeConsumerAccount: Wallet;

	// Broker
	let logStoreBroker: LogStoreNode;

	// Clients
	let publisherStreamrClient: StreamrClient;
	let consumerStreamrClient: StreamrClient;
	let consumerLogStoreClient: LogStoreClient;

	let tracker: Tracker;
	let testStream: Stream;

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
		await logStoreBroker.stop();
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
		consumerLogStoreClient = await createLogStoreClient(consumerStreamrClient, {
			nodeUrl: 'http://127.0.0.1:7171',
		});

		testStream = await createTestStream(publisherStreamrClient, module);

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
		await publisherStreamrClient.destroy();
		consumerLogStoreClient.destroy();
		await Promise.allSettled([logStoreBroker?.stop(), tracker?.stop()]);
	});

	it('when client publishes a message, it is written to the store', async () => {
		// TODO: the consumer must have permission to subscribe to the stream or the strem have to be public
		await testStream.grantPermissions({
			user: await consumerLogStoreClient
				.getSigner()
				.then((c) => c.getAddress()),
			permissions: [StreamPermission.SUBSCRIBE],
		});

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

	it('Temporary test: prover is ok on standalone mode', async () => {
		await sleep(5000);
		const result = await fetch('http://127.0.0.1:7171/prover/wiejew').catch(
			(e) => {
				console.log(e);
				throw e;
			}
		);

		expect(result.status).toEqual(200);
		expect(await result.text()).toContain('Path: /wiejew');
	});
});
