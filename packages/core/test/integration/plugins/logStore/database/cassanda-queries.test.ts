import { MessageID, StreamMessage, toStreamID } from '@streamr/protocol';
import { waitForStreamToEnd } from '@streamr/test-utils';
import {
	toEthereumAddress,
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

const DEFAULT_MOCK_STREAM_ID = 'mock-stream-id-' + Date.now();
const MOCK_PUBLISHER_ID = toEthereumAddress(
	'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);
const MOCK_MSG_CHAIN_ID = 'msgChainId';
const createMockMessage = (
	ts: number,
	sequence_no = 0,
	mockStreamId: string = DEFAULT_MOCK_STREAM_ID
) => {
	return new StreamMessage({
		messageId: new MessageID(
			toStreamID(mockStreamId),
			0,
			ts,
			sequence_no,
			MOCK_PUBLISHER_ID,
			MOCK_MSG_CHAIN_ID
		),
		content: {
			ts,
			sequence_no: sequence_no,
		},
		signature: 'signature',
	});
};
const MOCK_MESSAGES = [1, 2, 3].map((contentValue: number) =>
	createMockMessage(contentValue)
);

const EMPTY_STREAM_ID = 'empty-stream-id' + Date.now();

const REQUEST_TYPE_FROM = 'requestFrom';
const REQUEST_TYPE_RANGE = 'requestRange';

type TestMessage = StreamMessage<{
	ts: number;
	sequence_no: number;
}>;
const streamToContentValues = async (resultStream: Readable) => {
	const messages = (await waitForStreamToEnd(resultStream)) as TestMessage[];
	return messages.map((message) => message.getParsedContent().ts);
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
		streamId: string = DEFAULT_MOCK_STREAM_ID
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
	});

	describe('requestByMessageIds', () => {
		it('single happy path', async () => {
			const resultStream = cassandraAdapter.queryByMessageIds([
				MOCK_MESSAGES[0].messageId,
			]);
			const contentValues = await streamToContentValues(resultStream);
			expect(contentValues).toEqual([1]);
		});

		it('multiple happy path', async () => {
			const resultStream = cassandraAdapter.queryByMessageIds(
				MOCK_MESSAGES.map((msg) => msg.messageId)
			);
			const contentValues = await streamToContentValues(resultStream);
			expect(contentValues).toEqual([1, 2, 3]);
		});

		it('multiple happy path received in same order', async () => {
			const resultStream = cassandraAdapter.queryByMessageIds(
				[2, 1, 3].map((i) => MOCK_MESSAGES[i - 1].messageId)
			);
			const contentValues = await streamToContentValues(resultStream);
			expect(contentValues).toEqual([2, 1, 3]);
		});

		// Set to skip temporarily while it does not create a new bucket
		// but breaks all the other tests because of storing extra messages
		// whose are not expected by the other tests
		it('multiple with more than one bucket', async () => {
			const mockStreamId = DEFAULT_MOCK_STREAM_ID + '_multipleId_1';
			const mockStreamId2 = DEFAULT_MOCK_STREAM_ID + '_multipleId_2';

			const BUCKET_1_MESSAGES = [4, 5, 6].map((contentValue: number) =>
				createMockMessage(contentValue, undefined, mockStreamId)
			);
			const BUCKET_2_MESSAGES = [7, 8, 9].map((contentValue: number) =>
				createMockMessage(contentValue, undefined, mockStreamId2)
			);

			const allMessages = [...BUCKET_1_MESSAGES, ...BUCKET_2_MESSAGES];

			await Promise.all(allMessages.map((msg) => cassandraAdapter.store(msg)));
			await waitForStoredMessageCount(BUCKET_1_MESSAGES.length, mockStreamId);
			await waitForStoredMessageCount(BUCKET_2_MESSAGES.length, mockStreamId2);

			const resultStream = cassandraAdapter.queryByMessageIds(
				allMessages.map((msg) => msg.messageId)
			);

			const contentValues = await streamToContentValues(resultStream);
			expect(contentValues).toEqual([4, 5, 6, 7, 8, 9]);
		});

		it('not found', async () => {
			const resultStream = cassandraAdapter.queryByMessageIds([
				createMockMessage(999).messageId,
			]);
			const contentValues = await streamToContentValues(resultStream);
			expect(contentValues).toEqual([]);
		});

		it('not found in the middle', async () => {
			const resultStream = cassandraAdapter.queryByMessageIds(
				[1, 999, 3].map((i) => createMockMessage(i).messageId)
			);
			const contentValues = await streamToContentValues(resultStream);
			expect(contentValues).toEqual([1, 3]);
		});
	});

	describe('requestLast', () => {
		it('happy path', async () => {
			const resultStream = cassandraAdapter.queryLast(
				DEFAULT_MOCK_STREAM_ID,
				0,
				2
			);
			const contentValues = await streamToContentValues(resultStream);
			expect(contentValues).toEqual([2, 3]);
		});

		it('no messages', async () => {
			const resultStream = cassandraAdapter.queryLast(EMPTY_STREAM_ID, 0, 1);
			const contentValues = await streamToContentValues(resultStream);
			expect(contentValues).toEqual([]);
		});

		it('bucket query error', async () => {
			(cassandraAdapter.cassandraClient as any).setError('FROM bucket');
			const resultStream = cassandraAdapter.queryLast(
				DEFAULT_MOCK_STREAM_ID,
				0,
				1
			);
			const [actualError] = await waitForEvent(resultStream, 'error');
			expect(actualError).toBe(ProxyClient.ERROR);
		});

		it('message count query error', async () => {
			(cassandraAdapter.cassandraClient as any).setError(
				'total FROM stream_data'
			);
			const resultStream = cassandraAdapter.queryLast(
				DEFAULT_MOCK_STREAM_ID,
				0,
				1
			);
			const [actualError] = await waitForEvent(resultStream, 'error');
			expect(actualError).toBe(ProxyClient.ERROR);
		});

		it('message query error', async () => {
			(cassandraAdapter.cassandraClient as any).setError(
				'payload FROM stream_data'
			);
			const resultStream = cassandraAdapter.queryLast(
				DEFAULT_MOCK_STREAM_ID,
				0,
				1
			);
			const [actualError] = await waitForEvent(resultStream, 'error');
			expect(actualError).toBe(ProxyClient.ERROR);
		});
	});

	describe('requestFirst', () => {
		it('happy path', async () => {
			const resultStream = cassandraAdapter.queryFirst(
				DEFAULT_MOCK_STREAM_ID,
				0,
				2
			);
			const contentValues = await streamToContentValues(resultStream);
			expect(contentValues).toEqual([1, 2]);
		})
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
				const resultStream = getResultStream(DEFAULT_MOCK_STREAM_ID);
				const contentValues = await streamToContentValues(resultStream);
				expect(contentValues).toEqual([1, 2, 3]);
			});

			it('no messages', async () => {
				const resultStream = getResultStream(EMPTY_STREAM_ID);
				const contentValues = await streamToContentValues(resultStream);
				expect(contentValues).toEqual([]);
			});

			it('bucket query error', async () => {
				(cassandraAdapter.cassandraClient as any).setError('FROM bucket');
				const resultStream = getResultStream(DEFAULT_MOCK_STREAM_ID);
				const [actualError] = await waitForEvent(resultStream, 'error');
				expect(actualError).toBe(ProxyClient.ERROR);
			});

			it('message query error', async () => {
				(cassandraAdapter.cassandraClient as any).setError('FROM stream_data');
				const resultStream = getResultStream(DEFAULT_MOCK_STREAM_ID);
				const [actualError] = await waitForEvent(resultStream, 'error');
				expect(actualError).toBe(ProxyClient.ERROR);
			}, 99_000);
		}
	);
});
