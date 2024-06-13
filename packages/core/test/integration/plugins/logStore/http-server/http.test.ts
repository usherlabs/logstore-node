import { LogStoreClient, NodeMetadata } from '@logsn/client';
import {
	LogStoreManager,
	LogStoreNodeManager,
	LogStoreQueryManager,
	LSAN,
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
import { MessageID, StreamMessage, toStreamID } from '@streamr/protocol';
import StreamrClient, { Stream, StreamPermission } from '@streamr/sdk';
import {
	fetchPrivateKeyWithGas,
	KeyServer,
	randomEthereumAddress,
} from '@streamr/test-utils';
import {
	hexToBinary,
	MetricsContext,
	toEthereumAddress,
	verifySignature,
	wait,
} from '@streamr/utils';
import axios from 'axios';
import { Wallet } from 'ethers';
import { Request, RequestHandler, Response } from 'express';
import { range } from 'lodash';
import { Readable } from 'stream';

import { LogStoreNode } from '../../../../../src/node';
import { createSignaturePayload } from '../../../../../src/streamr/signature';
import {
	CONTRACT_OWNER_PRIVATE_KEY,
	createLogStoreClient,
	createStreamrClient,
	createTestStream,
	getProvider,
	sleep,
	startLogStoreBroker,
} from '../../../../utils';

jest.setTimeout(60000);

const STAKE_AMOUNT = BigInt(1e22);
const MESSAGE_STORE_TIMEOUT = 9 * 1000;
const BASE_NUMBER_OF_MESSAGES = 16;

const BROKER_URL = 'http://10.200.10.1:7171';

// setting a more easy to test limit
const mockTestLimit = BASE_NUMBER_OF_MESSAGES + 10;
jest.mock('../../../../../src/plugins/logStore/http/constants', () => {
	const originalModule = jest.requireActual(
		'../../../../../src/plugins/logStore/http/constants'
	);
	return {
		...originalModule,
		get EVENTS_PER_RESPONSE_LIMIT_ON_NON_STREAM() {
			return mockTestLimit;
		},
	};
});

const dataQueryTestMiddleware = jest.fn();

jest.mock('../../../../../src/plugins/logStore/http/dataQueryEndpoint', () => {
	const originalModule = jest.requireActual(
		'../../../../../src/plugins/logStore/http/dataQueryEndpoint'
	);

	const originalFn = (metrics: MetricsContext) => {
		const originalResult = originalModule.createDataQueryEndpoint(metrics);
		return {
			...originalResult,
			requestHandlers: [
				(req, res, next) => {
					dataQueryTestMiddleware(req, res, next);
				},
				...originalResult.requestHandlers,
			] as RequestHandler[],
		};
	};

	return {
		...originalModule,
		createDataQueryEndpoint: originalFn,
	};
});

describe('http works', () => {
	const provider = getProvider();

	// Accounts
	let adminAccount: Wallet;
	let logStoreBrokerAccount: Wallet;
	let publisherAccount: Wallet;
	let storeOwnerAccount: Wallet;
	let storeConsumerAccount: Wallet;

	// Broker
	let logStoreBroker: LogStoreNode;

	// Clients
	let publisherStreamrClient: StreamrClient;
	let consumerStreamrClient: StreamrClient;
	let consumerLogStoreClient: LogStoreClient;

	// Contracts
	let nodeManager: LogStoreNodeManager;
	let storeManager: LogStoreManager;
	let queryManager: LogStoreQueryManager;
	let nodeAdminManager: LogStoreNodeManager;
	let tokenAdminManager: LSAN;

	let testStream: Stream;

	beforeAll(async () => {
		logStoreBrokerAccount = new Wallet(
			await fetchPrivateKeyWithGas(),
			provider
		);
		// Accounts
		const [privateKey, privateKey1, privateKey2] = await Promise.all([
			fetchPrivateKeyWithGas(),
			fetchPrivateKeyWithGas(),
			fetchPrivateKeyWithGas(),
		]);
		// Accounts
		adminAccount = new Wallet(CONTRACT_OWNER_PRIVATE_KEY, provider);
		publisherAccount = new Wallet(privateKey, provider);
		storeOwnerAccount = new Wallet(privateKey1, provider);
		storeConsumerAccount = new Wallet(privateKey2, provider);

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
		const nodeMetadata: NodeMetadata = {
			http: BROKER_URL,
		};

		await nodeAdminManager
			.whitelistApproveNode(logStoreBrokerAccount.address)
			.then((tx: any) => tx.wait());
		await tokenAdminManager
			.addWhitelist(logStoreBrokerAccount.address, nodeManager.address)
			.then((tx: any) => tx.wait());

		await prepareStakeForNodeManager(logStoreBrokerAccount, STAKE_AMOUNT);

		await nodeManager
			.join(STAKE_AMOUNT, JSON.stringify(nodeMetadata))
			.then((tx: any) => tx.wait());

		// Wait for the granted permissions to the system stream
		await sleep(5000);

		[logStoreBroker, publisherStreamrClient, consumerStreamrClient] =
			await Promise.all([
				startLogStoreBroker({
					privateKey: logStoreBrokerAccount.privateKey,
					plugins: {
						logStore: {
							db: { type: 'cassandra' },
						},
					},
					mode: {
						type: 'network',
					},
				}),
				createStreamrClient(publisherAccount.privateKey),
				createStreamrClient(storeConsumerAccount.privateKey),
			]);

		consumerLogStoreClient = await createLogStoreClient(consumerStreamrClient);

		// Grant permission for querying

		// Creates a stream
		testStream = await createTestStream(publisherStreamrClient, module);
		// Stakes for storage
		await prepareStakeForStoreManager(storeOwnerAccount, STAKE_AMOUNT);
		await storeManager
			.stake(testStream.id, STAKE_AMOUNT)
			.then((tx: any) => tx.wait());

		Promise.all([
			// Stakes for querying
			(async () => {
				await prepareStakeForQueryManager(storeConsumerAccount, STAKE_AMOUNT);
				await queryManager.stake(STAKE_AMOUNT).then((tx: any) => tx.wait());
			})(),
			// makes it readable by the consumer
			testStream.grantPermissions({
				user: await consumerStreamrClient.getAddress(),
				permissions: [StreamPermission.SUBSCRIBE],
			}),
		]);

		await sleep(10_000);
	});

	afterEach(async () => {
		await publisherStreamrClient?.destroy();
		await consumerStreamrClient?.destroy();
		consumerLogStoreClient?.destroy();
		await Promise.allSettled([
			logStoreBroker?.stop(),
			nodeManager?.leave().then((tx: any) => tx.wait()),
		]);
	});

	// HELPERS

	async function publishMessages(numOfMessages: number) {
		for (const idx of range(numOfMessages)) {
			await publisherStreamrClient.publish(
				{
					id: testStream.id,
					partition: 0,
				},
				{
					messageNo: idx,
				}
			);
			await sleep(200);
		}
		await wait(MESSAGE_STORE_TIMEOUT);
	}

	const createQueryUrl = async ({
		type,
		options,
		streamId = testStream.id,
	}: {
		type: string;
		options: any;
		streamId?: string;
	}) => {
		return consumerLogStoreClient.createQueryUrl(
			BROKER_URL,
			{
				streamId,
				partition: 0,
			},
			type,
			options
		);
	};

	/**
	 * Creates query URLs for reuse
	 */
	const createQueryUrls = async ({
		lastCount,
		fromTimestamp,
		toTimestamp,
		format,
		streamId = testStream.id,
	}: {
		/// Number of messages to fetch just on the `last` query
		lastCount: number;
		fromTimestamp: number;
		toTimestamp: number;
		format?: 'raw' | 'object';
		streamId?: string;
	}) => {
		const queryUrlLast = await createQueryUrl({
			type: 'last',
			options: {
				format,
				count: lastCount,
				streamId,
			},
		});
		const queryUrlFrom = await createQueryUrl({
			type: 'from',
			options: {
				format,
				fromTimestamp,
				streamId,
			},
		});
		const queryUrlRange = await createQueryUrl({
			type: 'range',
			options: {
				format,
				fromTimestamp,
				toTimestamp,
				streamId,
			},
		});

		return { queryUrlLast, queryUrlFrom, queryUrlRange };
	};
	//

	describe.skip('JSON responses', () => {
		const performQuery = async ({
			queryUrl,
			token,
		}: {
			queryUrl: string;
			token: string;
		}) => {
			return axios
				.get(queryUrl, {
					headers: {
						Authorization: `Basic ${token}`,
					},
				})
				.then(({ data }: { data: any }) => data);
		};

		test('Query is normally fetched under messages limit', async () => {
			const timestampBefore = Date.now();
			await publishMessages(BASE_NUMBER_OF_MESSAGES);
			const timestampAfter = Date.now();

			const { queryUrlLast, queryUrlFrom, queryUrlRange } =
				await createQueryUrls({
					lastCount: BASE_NUMBER_OF_MESSAGES,
					// make sure we get everything
					fromTimestamp: timestampBefore - 10,
					toTimestamp: timestampAfter + 10,
				});
			const { token } = await consumerLogStoreClient.apiAuth();

			const queryResponses = await Promise.all(
				[queryUrlLast, queryUrlFrom, queryUrlRange].map((queryUrl) =>
					performQuery({ queryUrl, token })
				)
			);

			queryResponses.forEach((resp) => {
				// console.log('HTTP RESPONSE:', resp);
				expect(resp.messages).toHaveLength(BASE_NUMBER_OF_MESSAGES);
				expect(resp.metadata.hasNext).toBe(false);
				expect(resp.metadata.nextTimestamp).toBeUndefined();
				expect(resp).toMatchObject({
					messages: expect.any(Array),
					metadata: {
						hasNext: expect.any(Boolean),
					},
				});
			});
			expectAllItemsToBeEqual(queryResponses);
		});

		test('Query is limited if not using HTTP streams', async () => {
			const N_MESSAGES_TO_SEND = mockTestLimit + 10;

			const timestampBefore = Date.now();
			await publishMessages(N_MESSAGES_TO_SEND);
			const timestampAfter = Date.now();

			const { queryUrlRange, queryUrlLast, queryUrlFrom } =
				await createQueryUrls({
					lastCount: N_MESSAGES_TO_SEND,
					// make sure we get everything
					fromTimestamp: timestampBefore - 10,
					toTimestamp: timestampAfter + 10,
				});

			const { token } = await consumerLogStoreClient.apiAuth();

			const queryResponses = await Promise.all(
				[queryUrlLast, queryUrlFrom, queryUrlRange].map((queryUrl) =>
					performQuery({ queryUrl: queryUrl, token: token })
				)
			);

			queryResponses.forEach((resp) => {
				// console.log('HTTP RESPONSE:', resp);
				expect(resp.messages).toHaveLength(mockTestLimit);
				expect(resp.metadata.hasNext).toBe(true);
				expect(resp.metadata.nextTimestamp).toBeGreaterThan(timestampBefore);
				expect(resp).toMatchObject({
					messages: expect.any(Array),
					metadata: {
						hasNext: expect.any(Boolean),
						nextTimestamp: expect.any(Number),
						totalMessages: expect.any(Number),
					},
				});
			});

			// This won't be true, as the responses are limited, last query will have messages more recent
			// than the first query
			// VVVVVVVVVVVVVVVVVVVV
			// expectAllItemsToBeEqual(queryResponses);
		});

		test('Format is correct and response is verifiable', async () => {
			await publishMessages(BASE_NUMBER_OF_MESSAGES);

			const queryUrlLast = await createQueryUrl({
				type: 'last',
				options: { format: 'object', count: BASE_NUMBER_OF_MESSAGES },
			});

			const { token } = await consumerLogStoreClient.apiAuth();

			const queryResponse = await performQuery({
				queryUrl: queryUrlLast,
				token,
			});

			expect(queryResponse.messages).toHaveLength(BASE_NUMBER_OF_MESSAGES);
			const modelMessage = queryResponse.messages[0];
			expect(modelMessage).toEqual({
				streamId: expect.any(String),
				streamPartition: expect.any(Number),
				timestamp: expect.any(Number),
				sequenceNumber: expect.any(Number),
				publisherId: expect.any(String),
				msgChainId: expect.any(String),
				messageType: expect.any(Number),
				contentType: expect.any(Number),
				encryptionType: expect.any(Number),
				content: expect.any(String),
				signature: expect.any(String),
				signatureType: expect.any(Number),
				groupKeyId: expect.any(String),
			});
			const streamMessage = new StreamMessage({
				messageId: new MessageID(
					toStreamID(modelMessage.streamId),
					modelMessage.streamPartition,
					modelMessage.timestamp,
					modelMessage.sequenceNumber,
					modelMessage.publisherId,
					modelMessage.msgChainId
				),
				content: hexToBinary(modelMessage.content),
				contentType: modelMessage.contentType,
				encryptionType: modelMessage.encryptionType,
				signature: hexToBinary(modelMessage.signature),
				signatureType: modelMessage.signatureType,
				groupKeyId: modelMessage.groupKeyId,
			});

			const payload = createSignaturePayload(streamMessage);

			const verification = verifySignature(
				toEthereumAddress(publisherAccount.address),
				payload,
				streamMessage.signature
			);
			const badVerification = verifySignature(
				randomEthereumAddress(),
				payload,
				streamMessage.signature
			);

			expect(verification).toBe(true);
			expect(badVerification).toBe(false);
		});
	});

	describe.skip('Stream responses', () => {
		const performStreamedQuery = async ({
			queryUrl,
			token,
		}: {
			queryUrl: string;
			token: string;
		}) => {
			const httpStream = axios
				.get(queryUrl, {
					headers: {
						Authorization: `Basic ${token}`,
						Accept: 'text/event-stream',
					},
					responseType: 'stream',
				})
				.then(({ data }: { data: any }) => data as Readable);

			const response = await streamToMessages(httpStream);
			return response;
		};

		function streamToMessages(httpStream: Promise<Readable>) {
			return new Promise<{ messages: unknown[]; metadata: any }>(
				(resolve, reject) => {
					const messages: any[] = [];
					let metadata: any = {};
					httpStream
						.then((stream) => {
							stream.on('data', (chunk) => {
								// we know this chunk is a string as per our code, and not binary or any other type of data
								const eventFromChunk = JSON.parse(chunk);
								const isMetadata =
									'type' in eventFromChunk &&
									eventFromChunk.type === 'metadata';
								if (!isMetadata) {
									messages.push(eventFromChunk);
								} else {
									metadata = eventFromChunk;
								}
							});
							stream.on('end', () => {
								resolve({ messages, metadata });
							});
							stream.on('error', (err) => {
								reject(err);
							});
						})
						.catch((err) => {
							reject(err);
						});
				}
			);
		}

		test.skip('gets raw responses correctly', async () => {
			const timestampBefore = Date.now();
			await publishMessages(BASE_NUMBER_OF_MESSAGES);
			const timestampAfter = Date.now();

			const { queryUrlLast, queryUrlFrom, queryUrlRange } =
				await createQueryUrls({
					lastCount: BASE_NUMBER_OF_MESSAGES,
					fromTimestamp: timestampBefore - 10,
					toTimestamp: timestampAfter + 10,
					format: 'raw',
				});

			const { token } = await consumerLogStoreClient.apiAuth();

			const queryResponses = await Promise.all(
				[queryUrlLast, queryUrlFrom, queryUrlRange].map((queryUrl) =>
					performStreamedQuery({ queryUrl, token })
				)
			);

			queryResponses.forEach((response) => {
				expect(response.messages).toHaveLength(BASE_NUMBER_OF_MESSAGES);
			});

			expectAllItemsToBeEqual(queryResponses);
		});

		test('Querying below the limit returns normally', async () => {
			const timestampBefore = Date.now();
			await publishMessages(BASE_NUMBER_OF_MESSAGES);
			const timestampAfter = Date.now();

			const { queryUrlFrom, queryUrlLast, queryUrlRange } =
				await createQueryUrls({
					lastCount: BASE_NUMBER_OF_MESSAGES,
					fromTimestamp: timestampBefore - 10,
					toTimestamp: timestampAfter + 10,
				});

			const { token } = await consumerLogStoreClient.apiAuth();

			const queryResponses = await Promise.all(
				[queryUrlLast, queryUrlFrom, queryUrlRange].map((queryUrl) =>
					performStreamedQuery({ queryUrl, token })
				)
			);

			// const response = await streamToMessages(httpStream);
			queryResponses.forEach((response) => {
				expect(response.messages).toHaveLength(BASE_NUMBER_OF_MESSAGES);
			});
			expectAllItemsToBeEqual(queryResponses);
		});

		test('Querying above the limit is also OK on streams', async () => {
			const MESSAGES_ABOVE_QUERY_LIMIT = mockTestLimit + 10;

			const timestampBefore = Date.now();
			await publishMessages(MESSAGES_ABOVE_QUERY_LIMIT);
			const timestampAfter = Date.now();

			const { queryUrlRange, queryUrlLast, queryUrlFrom } =
				await createQueryUrls({
					lastCount: MESSAGES_ABOVE_QUERY_LIMIT,
					fromTimestamp: timestampBefore - 10,
					toTimestamp: timestampAfter + 10,
				});

			const { token } = await consumerLogStoreClient.apiAuth();

			const queryResponses = await Promise.all(
				[queryUrlLast, queryUrlFrom, queryUrlRange].map((queryUrl) =>
					performStreamedQuery({ queryUrl: queryUrl, token: token })
				)
			);

			queryResponses.forEach((resp) => {
				expect(resp.messages).toHaveLength(MESSAGES_ABOVE_QUERY_LIMIT);
			});
			expectAllItemsToBeEqual(queryResponses);
		});
	});

	describe('ready endpoint', () => {
		test('works', async () => {
			const encodedStreamId = encodeURIComponent(testStream.id);
			await axios
				.get(`${BROKER_URL}/stores/${encodedStreamId}/partitions/0/ready`)
				.then((res) => {
					// it's ready because the nodes are already connected to it
					expect(res.data).toStrictEqual({ ready: true });
				});
		});
	});

	test('Owner address is case insensitive', async () => {
		await publishMessages(BASE_NUMBER_OF_MESSAGES);
		await sleep(1000);

		// Define different cases for the owner address
		const addresses = [
			`0x${publisherAccount.address.slice(2).toLowerCase()}`,
			`0x${publisherAccount.address.slice(2).toUpperCase()}`,
		];
		// as in <ownerAddress>/<streamPath>
		const streamPath = testStream.id.slice(testStream.id.indexOf('/') + 1);
		const streamIds = addresses.map((address) => {
			// don't use toStreamID because it will convert to lowercase
			return `${address}/${streamPath}`;
		});

		const queryUrlsLast = streamIds.map(
			(streamId) =>
				`${BROKER_URL}/stores/${encodeURIComponent(streamId)}/data/partitions/0/last?count=${BASE_NUMBER_OF_MESSAGES}`
		);
		const { token } = await consumerLogStoreClient.apiAuth();

		// Perform queries using different cases of the owner address
		const queryResponses = await Promise.all(
			queryUrlsLast.map(async (url) => {
				return axios
					.get(url, {
						headers: {
							Authorization: `Basic ${token}`,
						},
					})
					.then(({ data }) => data);
			})
		);

		// assert response has data
		expect(queryResponses[0].messages).toHaveLength(BASE_NUMBER_OF_MESSAGES);

		// Assert that all responses are equal
		queryResponses.forEach((response, index, responses) => {
			if (index > 0) {
				expect(response).toEqual(responses[0]);
			}
		});

		describe('endpoints are triggered as expected', () => {
			test('encoded stream id', async () => {
				// this test works by mocking the data query middleware
				// in the log store module
				// we expect the middleware to be called with the correct params at least once,
				// indicating that the endpoint is triggered for this endpoint

				const encodedStreamId = encodeURIComponent(testStream.id);
				const { token } = await consumerLogStoreClient.apiAuth();
				const endpoint = `${BROKER_URL}/stores/${encodedStreamId}/data/partitions/0/last`;
				// mock endpoint handler
				dataQueryTestMiddleware.mockImplementationOnce(
					(req: Request, res: Response) => {
						expect(req.params.id).toBe(testStream.id);
						expect(req.params.partition).toBe('0');
						expect(req.params.queryType).toBe('last');
						res.json({ ready: true });
					}
				);

				await axios
					.get(endpoint, { headers: { authorization: `Bearer ${token}` } })
					.then((res) => {
						// it's ready because the nodes are already connected to it
						expect(res.data).toStrictEqual({ ready: true });
					});

				expect(dataQueryTestMiddleware).toHaveBeenCalledTimes(1);
			});

			test('plain stream id', async () => {
				// this test works by mocking the data query middleware
				// in the log store module
				// we expect the middleware to be called with the correct params at least once,
				// indicating that the endpoint is triggered for this endpoint

				const { token } = await consumerLogStoreClient.apiAuth();
				const endpoint = `${BROKER_URL}/stores/${testStream.id}/data/partitions/0/last`;
				// mock endpoint handler
				dataQueryTestMiddleware.mockImplementationOnce(
					(req: Request, res: Response) => {
						expect(req.params.id).toBe(testStream.id);
						expect(req.params.partition).toBe('0');
						expect(req.params.queryType).toBe('last');
						res.json({ ready: true });
					}
				);

				await axios
					.get(endpoint, { headers: { authorization: `Bearer ${token}` } })
					.then((res) => {
						// it's ready because the nodes are already connected to it
						expect(res.data).toStrictEqual({ ready: true });
					});
				expect(dataQueryTestMiddleware).toHaveBeenCalledTimes(1);
			});
		})
	});
});

const expectAllItemsToBeEqual = (items: any[]) => {
	const [firstItem, ...restItems] = items;
	const reference = JSON.stringify(firstItem);

	restItems.forEach((item) => {
		expect(JSON.stringify(item)).toBe(reference);
	});
};
