import { Tracker } from '@streamr/network-tracker';
import { fetchPrivateKeyWithGas, KeyServer } from '@streamr/test-utils';
import { providers, Wallet } from 'ethers';
import mqtt from 'mqtt';
import fetch from 'node-fetch';
import { firstValueFrom, ReplaySubject } from 'rxjs';
import StreamrClient, {
	Stream,
	StreamPermission,
	CONFIG_TEST as STREAMR_CLIENT_CONFIG_TEST,
} from 'streamr-client';
import WebSocket from 'ws';

import { LogStoreNode } from '../../../../src/node';
import {
	createStreamrClient,
	createTestStream,
	startLogStoreBroker,
	startTestTracker,
} from '../../../utils';

const TRACKER_PORT = undefined;
jest.setTimeout(60_000);

describe('Publish Interfaces', () => {
	let testStream: Stream;
	let tracker: Tracker;
	let logStoreBroker: LogStoreNode;
	let logStoreBrokerAccount: Wallet;
	let publisherStreamrClient: StreamrClient;
	let publisherAccount: Wallet;
	const AUTH_TOKEN = 'myPass';
	const nodeHttpEndpoint = 'http://127.0.0.1:7171';
	const nodeWSEndpoint = 'ws://127.0.0.1:7172';
	const mqttEndpoint = 'mqtt://127.0.0.1:1883';

	const testCallbacks = [] as (() => Promise<void> | void)[];

	const provider = new providers.JsonRpcProvider(
		STREAMR_CLIENT_CONFIG_TEST.contracts?.streamRegistryChainRPCs?.rpcs[0].url,
		STREAMR_CLIENT_CONFIG_TEST.contracts?.streamRegistryChainRPCs?.chainId
	);

	beforeAll(async () => {
		if (TRACKER_PORT) {
			tracker = await startTestTracker(TRACKER_PORT);
		}
	});

	beforeAll(async () => {
		logStoreBrokerAccount = new Wallet(await fetchPrivateKeyWithGas());
		publisherAccount = new Wallet(await fetchPrivateKeyWithGas(), provider);

		logStoreBroker = await startLogStoreBroker({
			privateKey: logStoreBrokerAccount.privateKey,
			trackerPort: TRACKER_PORT,
			enableLogStorePlugin: false,
			extraPlugins: {
				http: { apiAuthentication: { keys: [AUTH_TOKEN] } },
				mqtt: {
					port: 1883,
					payloadMetadata: true,
					apiAuthentication: { keys: [AUTH_TOKEN] },
				},
				websocket: {
					port: 7172,
					apiAuthentication: { keys: [AUTH_TOKEN] },
					disconnectTimeout: 10_000,
					payloadMetadata: true,
					pingSendInterval: 1_000,
				},
			},
		});
	}, 30 * 1000);

	beforeEach(async () => {
		publisherStreamrClient = await createStreamrClient(
			tracker,
			publisherAccount.privateKey
		);

		// create test stream
		testStream = await createTestStream(publisherStreamrClient, module);

		// permit logStore node to publish on this stream
		await publisherStreamrClient.grantPermissions(testStream.id, {
			user: logStoreBrokerAccount.address,
			permissions: [StreamPermission.PUBLISH],
		});
	});

	afterAll(async () => {
		await tracker?.stop();
		await logStoreBroker?.stop();
		// TODO: Setup global tear-down
		await KeyServer.stopIfRunning();
	});

	afterEach(async () => {
		try {
			await Promise.all(testCallbacks.map((cb) => cb()));
		} finally {
			testCallbacks.length = 0;
		}
	});

	describe('http', () => {
		it('can publish using http endpoint', async () => {
			// create replay subject
			// subscribe subject to stream
			const publishedMessages = new ReplaySubject(1);
			await publisherStreamrClient.subscribe(
				{
					stream: testStream.id,
				},
				(msg) => {
					publishedMessages.next(msg);
				}
			);

			// publish message
			const response = await fetch(
				`${nodeHttpEndpoint}/streams/${encodeURIComponent(testStream.id)}`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${AUTH_TOKEN}`,
					},
					body: JSON.stringify({ foo: 'bar' }),
				}
			);

			expect(response.status).toEqual(200);

			// wait for the first message
			const msg = await firstValueFrom(publishedMessages);

			// check that the message is correct
			expect(msg).toEqual({ foo: 'bar' });
		});

		it('Wrong authentication fails', async () => {
			// using wrong password
			const response = await fetch(
				`${nodeHttpEndpoint}/streams/${encodeURIComponent(testStream.id)}`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: 'Bearer wrongPass',
					},
					body: JSON.stringify({ foo: 'bar' }),
				}
			);

			expect(response.status).toEqual(403);

			// using no password
			const response2 = await fetch(
				`${nodeHttpEndpoint}/streams/${encodeURIComponent(testStream.id)}`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ foo: 'bar' }),
				}
			);

			expect(response2.status).toEqual(401);

			// using wrong format of header
			const response3 = await fetch(
				`${nodeHttpEndpoint}/streams/${encodeURIComponent(testStream.id)}`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: 'wrongPass',
					},
					body: JSON.stringify({ foo: 'bar' }),
				}
			);

			expect(response3.status).toEqual(401);
		});
	});

	describe('ws', () => {
		it('can publish using ws endpoint', async () => {
			// create replay subject
			// subscribe subject to stream
			const publishedMessages = new ReplaySubject(1);
			await publisherStreamrClient.subscribe(
				{
					stream: testStream.id,
				},
				(msg) => publishedMessages.next(msg)
			);

			const ws = new WebSocket(
				`${nodeWSEndpoint}/streams/${encodeURIComponent(
					testStream.id
				)}/publish?apiKey=${AUTH_TOKEN}`
			);

			testCallbacks.push(() => ws.close());

			await new Promise((resolve) => ws.once('open', resolve));

			// publish message
			ws.send(JSON.stringify({ content: { foo: 'bar' } }));

			// wait for the first message
			const msg = await firstValueFrom(publishedMessages);

			// check that the message is correct
			expect(msg).toEqual({ foo: 'bar' });
		});

		it('Wrong authentication fails', async () => {
			const ws = new WebSocket(
				`${nodeWSEndpoint}/streams/${encodeURIComponent(
					testStream.id
				)}/publish?apiKey=wrongPass`
			);

			testCallbacks.push(() => ws.close());

			// connection rejects
			const error = await new Promise<Error>((resolve) =>
				ws.once('error', (error) => resolve(error))
			);
			expect(error.message).toBe('Unexpected server response: 403');
		});
	});

	describe('mqtt', () => {
		it('can publish using mqtt endpoint', async () => {
			// create replay subject
			// subscribe subject to stream
			const publishedMessages = new ReplaySubject(1);
			await publisherStreamrClient.subscribe(
				{
					stream: testStream.id,
				},
				(msg) => publishedMessages.next(msg)
			);

			const client = mqtt.connect(mqttEndpoint, {
				username: '',
				password: AUTH_TOKEN,
			});

			testCallbacks.push(() => void client.end());

			await new Promise((resolve) => client.once('connect', resolve));

			// publish message
			client.publish(
				testStream.id,
				JSON.stringify({ content: { foo: 'bar' } })
			);

			// wait for the first message
			const msg = await firstValueFrom(publishedMessages);

			// check that the message is correct
			expect(msg).toEqual({ foo: 'bar' });
		});

		it('Wrong authentication fails', async () => {
			const client = mqtt.connect(mqttEndpoint, {
				username: 'wrongPass',
			});

			testCallbacks.push(() => void client.end());
			// connection rejects
			const error = await new Promise<Error>((resolve) => {
				client.on('error', (error) => {
					resolve(error);
				});
			});
			expect(error.message).toBe('Connection refused: Not authorized');
		});
	});
});
