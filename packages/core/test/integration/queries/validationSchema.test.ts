import { LogStoreClient } from '@logsn/client';
import { Tracker } from '@streamr/network-tracker';
import { fetchPrivateKeyWithGas, KeyServer } from '@streamr/test-utils';
import { providers, Wallet } from 'ethers';
import { defer, firstValueFrom, map, mergeAll, toArray } from 'rxjs';
import StreamrClient, {
	Stream,
	StreamPermission,
	CONFIG_TEST as STREAMR_CONFIG_TEST,
} from 'streamr-client';

import { LogStoreNode } from '../../../src/node';
import {
	createLogStoreClient,
	createStreamrClient,
	createTestStream,
	sleep,
	startLogStoreBroker,
	startTestTracker,
} from '../../utils';

jest.setTimeout(60000);

// There are two options to run the test managed by a value of the TRACKER_PORT constant:
// 1. TRACKER_PORT = undefined - run the test against the brokers running in dev-env and brokers run by the test script.
// 2. TRACKER_PORT = 17771 - run the test against only brokers run by the test script.
//    In this case dev-env doesn't run any brokers and there is no brokers joined the network (NodeManager.totalNodes == 0)
const TRACKER_PORT = undefined;

describe('Queries with validation schema', () => {
	jest.useFakeTimers({
		advanceTimers: true,
	});

	const provider = new providers.JsonRpcProvider(
		STREAMR_CONFIG_TEST.contracts?.streamRegistryChainRPCs?.rpcs[0].url,
		STREAMR_CONFIG_TEST.contracts?.streamRegistryChainRPCs?.chainId
	);
	const schema = {
		$id: 'https://example.com/demo.schema.json',
		$schema: 'http://json-schema.org/draft-07/schema#',
		type: 'object',
		additionalProperties: false,
		properties: {
			foo: {
				type: 'string',
			},
		},
	};
	const errorsStream$ = defer(() =>
		consumerStreamrClient.subscribe(errorStream.id)
	).pipe(mergeAll());
	const errorMessage$ = errorsStream$.pipe(map((s) => s.content));

	// Accounts
	let logStoreBrokerAccount: Wallet;
	let publisherAccount: Wallet;
	let storeConsumerAccount: Wallet;

	// Broker
	let logStoreBroker: LogStoreNode;

	// Clients
	let publisherStreamrClient: StreamrClient;
	let publisherLogStoreClient: LogStoreClient;
	let consumerStreamrClient: StreamrClient;
	let consumerLogStoreClient: LogStoreClient;
	let logStoreBrokerStreamrClient: StreamrClient;

	let tracker: Tracker;
	let testStream: Stream;
	let errorStream: Stream;

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
		consumerLogStoreClient = await createLogStoreClient(consumerStreamrClient, {
			nodeUrl: 'http://127.0.0.1:7171',
		});

		logStoreBrokerStreamrClient = await createStreamrClient(
			tracker,
			logStoreBrokerAccount.privateKey
		);

		testStream = await createTestStream(publisherStreamrClient, module);

		errorStream = await createTestStream(logStoreBrokerStreamrClient, module);

		// make error stream public to read
		await errorStream.grantPermissions({
			public: true,
			permissions: [StreamPermission.SUBSCRIBE],
		});

		// validation schema is only supported for public streams
		await testStream.grantPermissions({
			public: true,
			permissions: [StreamPermission.SUBSCRIBE],
		});

		await publisherLogStoreClient.setValidationSchema({
			streamId: testStream.id,
			schemaOrHash: schema,
			protocol: 'RAW',
		});

		// to ensure that the new schema is picked up
		await expect(
			publisherLogStoreClient.getValidationSchema({ streamId: testStream.id })
		).resolves.toEqual(schema);

		logStoreBroker = await startLogStoreBroker({
			privateKey: logStoreBrokerAccount.privateKey,
			trackerPort: TRACKER_PORT,
			plugins: {
				logStore: {
					db: {
						type: 'sqlite',
					},
				},
			},
			mode: {
				type: 'standalone',
				validationErrorsStream: errorStream.id,
				trackedStreams: [
					{
						id: testStream.id,
						partitions: 1,
					},
				],
			},
		});
		// necessary to wait for stream registration handlers
		await sleep(500);
	});

	afterEach(async () => {
		await Promise.all([
			publisherStreamrClient.destroy(),
			consumerStreamrClient.destroy(),
			logStoreBrokerStreamrClient.destroy(),
		]);
		consumerLogStoreClient.destroy();
		publisherLogStoreClient.destroy();
		await Promise.allSettled([logStoreBroker?.stop(), tracker?.stop()]);
	});

	it('when client publishes a valid message message, it is written to the store', async () => {
		await publisherStreamrClient.publish(testStream.id, {
			foo: 'bar 1',
		});

		await sleep(2000);

		const messageStream = await consumerLogStoreClient.query(testStream.id, {
			last: 2,
		});

		const messages = await firstValueFrom(
			messageStream.asObservable().pipe(toArray())
		);

		expect(messages.length).toEqual(1);
		expect(messages[0].content).toEqual({ foo: 'bar 1' });
	});

	it('when client publishes an invalid message message, it is not written to the store', async () => {
		const firstErrorMessage = firstValueFrom(errorMessage$);

		await publisherStreamrClient.publish(testStream.id, {
			foo: 1,
		});

		await sleep(2000);

		const messageStream = await consumerLogStoreClient.query(testStream.id, {
			last: 2,
		});

		const messages = await firstValueFrom(
			messageStream.asObservable().pipe(toArray())
		);

		expect(messages.length).toEqual(0);
		expect(await firstErrorMessage).toEqual({
			errors: [expect.stringContaining('/foo must be string')],
			streamId: testStream.id,
		});
	});

	it('will NOT work with private schemas, and messages will be stored even with a schema', async () => {
		await testStream.revokePermissions({
			public: true,
			permissions: [StreamPermission.SUBSCRIBE],
		});
		await testStream.grantPermissions({
			user: await consumerStreamrClient.getAddress(),
			permissions: [StreamPermission.SUBSCRIBE],
		});

		await publisherLogStoreClient.setValidationSchema({
			streamId: testStream.id,
			schemaOrHash: schema,
			protocol: 'RAW',
		});
		// to ensure that the new schema is picked up
		jest.advanceTimersByTime(300_000);
		// schemas to be picked up
		await sleep(1_000);

		await publisherStreamrClient.publish(testStream.id, {
			foo: 'bar 1',
		});

		await sleep(2000);

		const messageStream = await consumerLogStoreClient.query(testStream.id, {
			last: 2,
		});

		const messages = await firstValueFrom(
			messageStream.asObservable().pipe(toArray())
		);

		expect(messages.length).toEqual(1);
		expect(messages[0].content).toEqual({ foo: 'bar 1' });
	});

	it('creating a bad schema will NOT break the feature', async () => {
		const validationSchemaUpdatePromise =
			publisherLogStoreClient.setValidationSchema({
				streamId: testStream.id,
				schemaOrHash: {
					foo: 'bar',
					type: 'unknown',
					// @ts-ignore
					id: 1,
					apple: 'banana',
				},
				protocol: 'RAW',
			});

		await expect(validationSchemaUpdatePromise).rejects.toThrow(
			'schema is invalid'
		);

		// string schema
		// @ts-ignore
		await publisherLogStoreClient.setValidationSchema({
			streamId: testStream.id,
			schemaOrHash: 'foo',
			protocol: 'RAW',
		});

		jest.advanceTimersByTime(300_000);
		await sleep(500);

		const firstErrorMessage = firstValueFrom(errorMessage$);

		await publisherStreamrClient.publish(testStream.id, {
			foo: 'bar 1',
		});

		await sleep(2000);

		const messageStream = await consumerLogStoreClient.query(testStream.id, {
			last: 2,
		});

		const messages = await firstValueFrom(
			messageStream.asObservable().pipe(toArray())
		);

		expect(messages.length).toEqual(0);
		expect(await firstErrorMessage).toEqual({
			errors: [expect.stringContaining('Invalid schema')],
			streamId: testStream.id,
		});

		// now we create a good one to see if now it's ok

		await publisherLogStoreClient.setValidationSchema({
			streamId: testStream.id,
			schemaOrHash: schema,
			protocol: 'RAW',
		});

		// to ensure that the new schema is picked up
		jest.advanceTimersByTime(300_000);
		// schemas to be picked up
		await sleep(500);

		await publisherStreamrClient.publish(testStream.id, {
			bad: 'bar 1',
		});

		await sleep(2000);

		const messageStream2 = await consumerLogStoreClient.query(testStream.id, {
			last: 2,
		});

		const messages2 = await firstValueFrom(
			messageStream2.asObservable().pipe(toArray())
		);

		expect(messages2.length).toEqual(0);
	});
});
