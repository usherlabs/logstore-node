import {
	ContentType,
	EncryptionType,
	MessageID,
	SignatureType,
	StreamMessage,
	toStreamID,
} from '@streamr/protocol';
import { waitForStreamToEnd } from '@streamr/test-utils';
import { convertBytesToStreamMessage } from '@streamr/trackerless-network';
import {
	hexToBinary,
	toEthereumAddress,
	utf8ToBinary,
	waitForCondition,
	waitForEvent,
} from '@streamr/utils';
import { Client } from 'cassandra-driver';
import { PassThrough, Readable } from 'stream';

import { CassandraDBAdapter } from '../../../../../src/plugins/logStore/database/CassandraDBAdapter';
import { STREAMR_DOCKER_DEV_HOST } from '../../../../utils';

const contactPoints = [STREAMR_DOCKER_DEV_HOST];
const localDataCenter = 'datacenter1';
const keyspace = 'logstore_dev';

const MOCK_STREAM_ID = `mock-stream-id-${Date.now()}`;
const MOCK_PARTITION = 0;
const MOCK_PUBLISHER_ID = toEthereumAddress(
	'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);
const MOCK_MSG_CHAIN_ID = 'msgChainId';

const createMockMessage = (
	timestamp: number,
	sequence_no = 0,
	streamId: string = MOCK_STREAM_ID,
	partition: number = MOCK_PARTITION
) => {
	return new StreamMessage({
		messageId: new MessageID(
			toStreamID(streamId),
			partition,
			timestamp,
			sequence_no,
			MOCK_PUBLISHER_ID,
			MOCK_MSG_CHAIN_ID
		),
		content: utf8ToBinary(
			JSON.stringify({
				timestamp,
				sequence_no,
			})
		),
		signature: hexToBinary('0x1234'),
		contentType: ContentType.JSON,
		encryptionType: EncryptionType.NONE,
		signatureType: SignatureType.SECP256K1,
	});
};
const MOCK_MESSAGES = [1, 2, 3].map((contentValue: number) =>
	createMockMessage(contentValue)
);

const EMPTY_STREAM_ID = `empty-stream-id-${Date.now()}`;

const REQUEST_TYPE_FROM = 'requestFrom';
const REQUEST_TYPE_RANGE = 'requestRange';

type TestMessage = {
	timestamp: number;
	sequence_no: number;
};

const streamToContentValues = async (resultStream: Readable) => {
	const messages: Uint8Array[] = (await waitForStreamToEnd(
		resultStream
	)) as Uint8Array[];
	return messages
		.map((bytes) => {
			return convertBytesToStreamMessage(bytes);
		})
		.map((message) => message.getParsedContent() as TestMessage)
		.flatMap((message) => [message.timestamp, message.sequence_no]);
};

class ProxyClient {
	static ERROR = new Error('mock-error');

	private realClient: Client;
	private errorQueryId: string | undefined;

	constructor(realClient: Client) {
		this.realClient = realClient;
	}

	eachRow(
		query: string,
		params: any,
		options: any,
		rowCallback: any,
		resultCallback?: (err: Error | undefined, result: any) => void
	) {
		if (this.hasError(query)) {
			resultCallback!(ProxyClient.ERROR, undefined);
		} else {
			return this.realClient.eachRow(
				query,
				params,
				options,
				rowCallback,
				resultCallback
			);
		}
	}

	execute(query: string, params: any, options: any) {
		if (this.hasError(query)) {
			return Promise.reject(ProxyClient.ERROR);
		} else {
			return this.realClient.execute(query, params, options);
		}
	}

	stream(query: string, params: any, options: any, callback: any) {
		if (this.hasError(query)) {
			const stream = new PassThrough({
				objectMode: true,
			});
			stream.destroy(ProxyClient.ERROR);
			return stream;
		} else {
			return this.realClient.stream(query, params, options, callback);
		}
	}

	shutdown(): Promise<void> {
		return this.realClient.shutdown();
	}

	setError(queryId: string) {
		this.errorQueryId = queryId;
	}

	private hasError(query: string): boolean {
		return this.errorQueryId !== undefined && query.includes(this.errorQueryId);
	}
}

describe('cassanda-queries', () => {
	let cassandraAdapter: CassandraDBAdapter;
	let realClient: Client;

	const waitForStoredMessageCount = async (
		expectedCount: number,
		streamId: string = MOCK_STREAM_ID
	) => {
		return waitForCondition(async () => {
			const result = await realClient.execute(
				'SELECT COUNT(*) AS total FROM stream_data WHERE stream_id = ? ALLOW FILTERING',
				[streamId]
			);
			const actualCount = result.rows[0].total.low;
			return actualCount === expectedCount;
		});
	};

	beforeAll(async () => {
		cassandraAdapter = new CassandraDBAdapter(
			{
				type: 'cassandra',
				contactPoints,
				localDataCenter,
				keyspace,
			},
			{
				checkFullBucketsTimeout: 100,
				storeBucketsTimeout: 100,
				bucketKeepAliveSeconds: 5,
			}
		);
		realClient = cassandraAdapter.cassandraClient;
		await Promise.all(MOCK_MESSAGES.map((msg) => cassandraAdapter.store(msg)));
		await waitForStoredMessageCount(MOCK_MESSAGES.length);
	});

	afterAll(async () => {
		await cassandraAdapter?.stop(); // also cleans up realClient
	});

	beforeEach(async () => {
		const proxyClient = new ProxyClient(realClient) as any;
		cassandraAdapter.cassandraClient = proxyClient;
		// cassandraAdapter.bucketManager.cassandraClient = proxyClient;
	});

	describe('queryByMessageRefs', () => {
		it('single happy path', async () => {
			const resultStream = cassandraAdapter.queryByMessageRefs(
				MOCK_STREAM_ID,
				MOCK_PARTITION,
				[MOCK_MESSAGES[0].getMessageRef()]
			);
			const contentValues = await streamToContentValues(resultStream);
			expect(contentValues).toEqual([1, 0]);
		});

		it('multiple happy path', async () => {
			const resultStream = cassandraAdapter.queryByMessageRefs(
				MOCK_STREAM_ID,
				MOCK_PARTITION,
				MOCK_MESSAGES.map((msg) => msg.getMessageRef())
			);
			const contentValues = await streamToContentValues(resultStream);
			expect(contentValues).toEqual([1, 0, 2, 0, 3, 0]);
		});

		it('multiple happy path received in same order', async () => {
			const resultStream = cassandraAdapter.queryByMessageRefs(
				MOCK_STREAM_ID,
				MOCK_PARTITION,
				[2, 1, 3].map((i) => MOCK_MESSAGES[i - 1].getMessageRef())
			);
			const contentValues = await streamToContentValues(resultStream);
			expect(contentValues).toEqual([2, 0, 1, 0, 3, 0]);
		});

		// Set to skip temporarily while it does not create a new bucket
		// but breaks all the other tests because of storing extra messages
		// whose are not expected by the other tests
		it.skip('multiple with more than one bucket', async () => {
			const mockStreamId1 = MOCK_STREAM_ID + '_multipleId_1';
			const mockStreamId2 = MOCK_STREAM_ID + '_multipleId_2';

			const BUCKET_1_MESSAGES = [4, 5, 6].map((contentValue: number) =>
				createMockMessage(contentValue)
			);
			const BUCKET_2_MESSAGES = [7, 8, 9].map((contentValue: number) =>
				createMockMessage(contentValue)
			);

			const allMessages = [...BUCKET_1_MESSAGES, ...BUCKET_2_MESSAGES];

			await Promise.all(allMessages.map((msg) => cassandraAdapter.store(msg)));
			await waitForStoredMessageCount(BUCKET_1_MESSAGES.length, mockStreamId1);
			await waitForStoredMessageCount(BUCKET_2_MESSAGES.length, mockStreamId2);

			const resultStream = cassandraAdapter.queryByMessageRefs(
				MOCK_STREAM_ID,
				MOCK_PARTITION,
				allMessages.map((msg) => msg.getMessageRef())
			);

			const contentValues = await streamToContentValues(resultStream);
			expect(contentValues).toEqual([4, 5, 6, 7, 8, 9]);
		});

		it('not found', async () => {
			const resultStream = cassandraAdapter.queryByMessageRefs(
				MOCK_STREAM_ID,
				MOCK_PARTITION,
				[createMockMessage(999).getMessageRef()]
			);
			const contentValues = await streamToContentValues(resultStream);
			expect(contentValues).toEqual([]);
		});

		it('not found in the middle', async () => {
			const resultStream = cassandraAdapter.queryByMessageRefs(
				MOCK_STREAM_ID,
				MOCK_PARTITION,
				[1, 999, 3].map((i) => createMockMessage(i).getMessageRef())
			);
			const contentValues = await streamToContentValues(resultStream);
			expect(contentValues).toEqual([1, 0, 3, 0]);
		});
	});

	describe('requestLast', () => {
		it('happy path', async () => {
			const resultStream = cassandraAdapter.queryLast(MOCK_STREAM_ID, 0, 2);
			const contentValues = await streamToContentValues(resultStream);
			expect(contentValues).toEqual([2, 0, 3, 0]);
		});

		it('no messages', async () => {
			const resultStream = cassandraAdapter.queryLast(EMPTY_STREAM_ID, 0, 1);
			const contentValues = await streamToContentValues(resultStream);
			expect(contentValues).toEqual([]);
		});

		it('bucket query error', async () => {
			(cassandraAdapter.cassandraClient as any).setError('FROM bucket');
			const resultStream = cassandraAdapter.queryLast(MOCK_STREAM_ID, 0, 1);
			const [actualError] = await waitForEvent(resultStream, 'error');
			expect(actualError).toBe(ProxyClient.ERROR);
		});

		it('message count query error', async () => {
			(cassandraAdapter.cassandraClient as any).setError(
				'total FROM stream_data'
			);
			const resultStream = cassandraAdapter.queryLast(MOCK_STREAM_ID, 0, 1);
			const [actualError] = await waitForEvent(resultStream, 'error');
			expect(actualError).toBe(ProxyClient.ERROR);
		});

		it('message query error', async () => {
			(cassandraAdapter.cassandraClient as any).setError(
				'payload FROM stream_data'
			);
			const resultStream = cassandraAdapter.queryLast(MOCK_STREAM_ID, 0, 1);
			const [actualError] = await waitForEvent(resultStream, 'error');
			expect(actualError).toBe(ProxyClient.ERROR);
		});
	});

	describe('requestFirst', () => {
		it('happy path', async () => {
			const resultStream = cassandraAdapter.queryFirst(MOCK_STREAM_ID, 0, 2);
			const contentValues = await streamToContentValues(resultStream);
			expect(contentValues).toEqual([1, 0, 2, 0]);
		});
		// we're not testing other cases because the logic is reused from requestLast
	});

	describe.each([
		[REQUEST_TYPE_FROM, undefined, undefined],
		[REQUEST_TYPE_FROM, MOCK_PUBLISHER_ID, undefined],
		[REQUEST_TYPE_RANGE, undefined, undefined],
		[REQUEST_TYPE_RANGE, MOCK_PUBLISHER_ID, MOCK_MSG_CHAIN_ID],
	])(
		'%s, publisher: %p',
		(
			requestType: string,
			publisherId: string | undefined,
			msgChainId: string | undefined
		) => {
			const getResultStream = (streamId: string): Readable => {
				const minMockTimestamp = MOCK_MESSAGES[0].getTimestamp();
				const maxMockTimestamp =
					MOCK_MESSAGES[MOCK_MESSAGES.length - 1].getTimestamp();
				if (requestType === REQUEST_TYPE_FROM) {
					return cassandraAdapter.queryRange(
						streamId,
						0,
						minMockTimestamp,
						0,
						maxMockTimestamp,
						0,
						publisherId
					);
				} else if (requestType === REQUEST_TYPE_RANGE) {
					return cassandraAdapter.queryRange(
						streamId,
						0,
						minMockTimestamp,
						0,
						maxMockTimestamp,
						0,
						publisherId,
						msgChainId
					);
				} else {
					throw new Error('Assertion failed');
				}
			};

			it('happy path', async () => {
				const resultStream = getResultStream(MOCK_STREAM_ID);
				const contentValues = await streamToContentValues(resultStream);
				expect(contentValues).toEqual([1, 0, 2, 0, 3, 0]);
			});

			it('no messages', async () => {
				const resultStream = getResultStream(EMPTY_STREAM_ID);
				const contentValues = await streamToContentValues(resultStream);
				expect(contentValues).toEqual([]);
			});

			it('bucket query error', async () => {
				(cassandraAdapter.cassandraClient as any).setError('FROM bucket');
				const resultStream = getResultStream(MOCK_STREAM_ID);
				const [actualError] = await waitForEvent(resultStream, 'error');
				expect(actualError).toBe(ProxyClient.ERROR);
			});

			it('message query error', async () => {
				(cassandraAdapter.cassandraClient as any).setError('FROM stream_data');
				const resultStream = getResultStream(MOCK_STREAM_ID);
				const [actualError] = await waitForEvent(resultStream, 'error');
				expect(actualError).toBe(ProxyClient.ERROR);
			}, 99_000);
		}
	);

	describe('Duplicate Messages', () => {
		it('handles duplicate messages without errors and maintains bucket size', async () => {
			const uniqueStreamId = `unique-stream-id-duplicates-${Date.now()}`;

			// Check if rows exist
			const initialRowsResult = await realClient.execute(
				'SELECT COUNT(*) as count FROM bucket WHERE stream_id = ? AND partition = ?',
				[uniqueStreamId, MOCK_PARTITION],
				{ prepare: true }
			);
			const initialRowsCount = initialRowsResult.rows[0].count.low;

			const getBucketSize = async () => {
				const result = await realClient.execute(
					'SELECT SUM(size) as total FROM bucket WHERE stream_id = ? AND partition = ?',
					[uniqueStreamId, MOCK_PARTITION],
					{ prepare: true }
				);
				return result.rows[0].total;
			};


			let initialBucketSize = 0;
			if (initialRowsCount > 0) {
				initialBucketSize = await getBucketSize()
			}


			const message = createMockMessage(1, 0, uniqueStreamId);
			const duplicateMessage = message
			const message2 = createMockMessage(2, 0, uniqueStreamId);

			// store first message
			await cassandraAdapter.store(message);
			const bucketSizeAfterFirstMessage = await getBucketSize()

			expect (bucketSizeAfterFirstMessage).toBeGreaterThan(initialBucketSize)

			// store 1 duplicate message and one new. Doesn't wait so it can be processed in a single batch
			void cassandraAdapter.store(duplicateMessage);
			await cassandraAdapter.store(message2);

			// Query the stored messages
			const resultStream = cassandraAdapter.queryLast(
				uniqueStreamId,
				MOCK_PARTITION,
				10
			);
			const contentValues = await streamToContentValues(resultStream);

			// Check that only one instance of the message is stored
			expect(contentValues).toEqual([1, 0, 2, 0]);

			// Check final bucket size
			const finalBucketSize = await getBucketSize();

			// Check that the bucket size remains the same
			expect(finalBucketSize).toBe(bucketSizeAfterFirstMessage);
		});
	});
});
