import { LogStoreClient } from '@logsn/client';
import StreamrClient, { Stream, StreamPermission } from '@streamr/sdk';
import { fetchPrivateKeyWithGas, KeyServer } from '@streamr/test-utils';
import { waitForCondition } from '@streamr/utils';
import { Wallet } from 'ethers';

import { LogStoreNode } from '../../../src/node';
import {
	createLogStoreClient,
	createStreamrClient,
	createTestStream,
	getProvider,
	sleep,
	startLogStoreBroker,
} from '../../utils';

jest.setTimeout(60000);

const STAKE_AMOUNT = BigInt('1000000000000000000');

describe('Standalone Mode Queries', () => {
	const provider = getProvider();

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
	});

	beforeEach(async () => {
		// Wait for the granted permissions to the system stream
		await sleep(5000);

		publisherStreamrClient = await createStreamrClient(
			publisherAccount.privateKey
		);

		consumerStreamrClient = await createStreamrClient(
			storeConsumerAccount.privateKey
		);
		consumerLogStoreClient = await createLogStoreClient(consumerStreamrClient, {
			nodeUrl: 'http://10.200.10.1:7171',
		});

		testStream = await createTestStream(publisherStreamrClient, module);

		logStoreBroker = await startLogStoreBroker({
			privateKey: logStoreBrokerAccount.privateKey,
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
		await publisherStreamrClient?.destroy();
		await consumerStreamrClient?.destroy();
		consumerLogStoreClient?.destroy();
		await Promise.allSettled([logStoreBroker?.stop()]);
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
});
