import StreamrClient, { Message, Stream, StreamPermission } from '@streamr/sdk';
import { fetchPrivateKeyWithGas, KeyServer } from '@streamr/test-utils';
import { Wallet } from 'ethers';

import {
	createStreamrClient,
	createTestStream,
	fetchWalletsWithGas,
	getProvider,
	publishTestMessages,
} from '../../../utils';

const STORAGE_PROXY_ADDRESS = '0x718811e2d1170db844d0c5de6d276b299f2916a9';

describe('StorageProxy resends', () => {
	const provider = getProvider();

	// Accounts
	let ownerAccount: Wallet;

	// Clients
	let ownerClient: StreamrClient;

	let testStream: Stream;

	let publishedMessages: (Message & { originalContent: string })[];

	beforeAll(async () => {
		// Accounts
		ownerAccount = new Wallet(await fetchPrivateKeyWithGas(), provider);

		ownerClient = await createStreamrClient(ownerAccount.privateKey);
	}, 30 * 1000);

	afterAll(async () => {
		// TODO: Tear-down the test stream once implemented delete of a store
		// await testStream.removeFromStorageNode(storageProxyAccount.address);
		// await testStream.delete();

		await ownerClient?.destroy();
		// TODO: Setup global tear-down
		await KeyServer.stopIfRunning();
	});

	describe('Public stream', () => {
		beforeAll(async () => {
			testStream = await createTestStream(ownerClient, module);

			await testStream.grantPermissions({
				public: true,
				permissions: [StreamPermission.SUBSCRIBE],
			});

			await testStream.addToStorageNode(STORAGE_PROXY_ADDRESS);

			publishedMessages = await publishTestMessages(ownerClient, testStream, 5);
		}, 30 * 1000);

		it('Resends Last', async () => {
			const messages: Message[] = [];
			const messageStream = await ownerClient.resend(testStream.id, {
				last: 5,
			});

			for await (const message of messageStream) {
				messages.push(message);
			}

			expect(messages.length).toEqual(5);
			expect(messages[0].content).toEqual(publishedMessages[0].originalContent);
			expect(messages[4].content).toEqual(publishedMessages[4].originalContent);
		});

		it('Resends From', async () => {
			const messages = [];
			const messageStream = await ownerClient.resend(testStream.id, {
				from: {
					timestamp: publishedMessages[2].timestamp,
				},
			});

			for await (const message of messageStream) {
				messages.push(message);
			}

			expect(messages.length).toEqual(3);
			expect(messages[0].content).toEqual(publishedMessages[2].content);
			expect(messages[1].content).toEqual(publishedMessages[3].content);
			expect(messages[2].content).toEqual(publishedMessages[4].content);
		});

		it('Resends Range', async () => {
			const messages = [];
			const messageStream = await ownerClient.resend(testStream.id, {
				from: {
					timestamp: publishedMessages[1].timestamp,
				},
				to: {
					timestamp: publishedMessages[3].timestamp,
				},
			});

			for await (const message of messageStream) {
				messages.push(message);
			}

			expect(messages.length).toEqual(3);
			expect(messages[0].content).toEqual(publishedMessages[1].content);
			expect(messages[1].content).toEqual(publishedMessages[2].content);
			expect(messages[2].content).toEqual(publishedMessages[3].content);
		});
	});

	describe('Private stream', () => {
		// Accounts
		let publisherAccount: Wallet;
		let subscriberAccount: Wallet;

		// Clients
		let publisherClient: StreamrClient;
		let subscriberClient: StreamrClient;

		beforeAll(async () => {
			[publisherAccount, subscriberAccount] = await fetchWalletsWithGas(
				provider,
				2
			);

			publisherClient = await createStreamrClient(publisherAccount.privateKey);

			subscriberClient = await createStreamrClient(
				subscriberAccount.privateKey
			);

			testStream = await createTestStream(ownerClient, module);

			await ownerClient.grantPermissions(testStream.id, {
				user: publisherAccount.address,
				permissions: [StreamPermission.PUBLISH],
			});

			await ownerClient.grantPermissions(testStream.id, {
				user: subscriberAccount.address,
				permissions: [StreamPermission.SUBSCRIBE],
			});

			await testStream.addToStorageNode(STORAGE_PROXY_ADDRESS);

			publishedMessages = await publishTestMessages(
				publisherClient,
				testStream,
				5
			);
		}, 60 * 1000);

		afterAll(async () => {
			await subscriberClient?.destroy();
			await publisherClient?.destroy();
		});

		it('Resends Last', async () => {
			const messages: Message[] = [];
			const messageStream = await subscriberClient.resend(testStream.id, {
				last: 5,
			});

			for await (const message of messageStream) {
				messages.push(message);
			}

			expect(messages.length).toEqual(5);
			expect(messages[0].content).toEqual(publishedMessages[0].originalContent);
			expect(messages[4].content).toEqual(publishedMessages[4].originalContent);
		});

		it('Resends From', async () => {
			const messages = [];
			const messageStream = await subscriberClient.resend(testStream.id, {
				from: {
					timestamp: publishedMessages[2].timestamp,
				},
			});

			for await (const message of messageStream) {
				messages.push(message);
			}

			expect(messages.length).toEqual(3);
			expect(messages[0].content).toEqual(publishedMessages[2].originalContent);
			expect(messages[1].content).toEqual(publishedMessages[3].originalContent);
			expect(messages[2].content).toEqual(publishedMessages[4].originalContent);
		});

		it('Resends Range', async () => {
			const messages = [];
			const messageStream = await subscriberClient.resend(testStream.id, {
				from: {
					timestamp: publishedMessages[1].timestamp,
				},
				to: {
					timestamp: publishedMessages[3].timestamp,
				},
			});

			for await (const message of messageStream) {
				messages.push(message);
			}

			expect(messages.length).toEqual(3);
			expect(messages[0].content).toEqual(publishedMessages[1].originalContent);
			expect(messages[1].content).toEqual(publishedMessages[2].originalContent);
			expect(messages[2].content).toEqual(publishedMessages[3].originalContent);
		});
	});
});
