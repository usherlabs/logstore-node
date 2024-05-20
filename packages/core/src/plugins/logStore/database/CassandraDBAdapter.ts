import { MessageRef, StreamMessage } from '@streamr/protocol';
import { convertStreamMessageToBytes } from '@streamr/trackerless-network';
import { Logger } from '@streamr/utils';
import { auth, Client, tracker, types } from 'cassandra-driver';
import merge2 from 'merge2';
import { pipeline, Readable, Transform } from 'stream';
import { v1 as uuidv1 } from 'uuid';

import { sleep } from '../../../utils/sleep';
import { BatchManager } from '../BatchManager';
import { Bucket, BucketId } from '../Bucket';
import { BucketManager } from '../BucketManager';
import {
	CommonDBOptions,
	MAX_SEQUENCE_NUMBER_VALUE,
	MIN_SEQUENCE_NUMBER_VALUE,
} from '../LogStore';
import { DatabaseAdapter, QueryDebugInfo } from './DatabaseAdapter';

const logger = new Logger(module);

const MAX_RESEND_LAST = 10000;

export interface CassandraDBOptions {
	type: 'cassandra';
	contactPoints: string[];
	localDataCenter: string;
	keyspace: string;
	username?: string;
	password?: string;
}

// this is maintained for backwards compatibility
export type CassandraOptionsFromConfig = {
	type: 'cassandra';
	hosts: string[];
	username: string;
	password: string;
	keyspace: string;
	datacenter: string;
};

export const bucketsToIds = (buckets: Bucket[]) =>
	buckets.map((bucket: Bucket) => bucket.getId());

export class CassandraDBAdapter extends DatabaseAdapter {
	bucketManager: BucketManager;
	batchManager: BatchManager;
	pendingStores: Map<string, NodeJS.Timeout>;
	cassandraClient: Client;

	constructor(
		cassandraDBOptions: CassandraDBOptions,
		private commonOpts: CommonDBOptions
	) {
		super();

		const { username, password, contactPoints, localDataCenter, keyspace } =
			cassandraDBOptions;
		const authProvider = new auth.PlainTextAuthProvider(
			username || '',
			password || ''
		);
		const requestLogger = new tracker.RequestLogger({
			slowThreshold: 10 * 1000, // 10 secs
		});
		// @ts-expect-error 'emitter' field is missing in type definition file
		requestLogger.emitter.on('slow', (message: Todo) => logger.warn(message));
		this.cassandraClient = new Client({
			contactPoints,
			localDataCenter,
			keyspace,
			authProvider,
			requestTracker: requestLogger,
			pooling: {
				maxRequestsPerConnection: 32768,
			},
		});

		this.bucketManager = new BucketManager(this, commonOpts);
		this.batchManager = new BatchManager(this.cassandraClient, {
			useTtl: commonOpts.useTtl,
		});
		this.pendingStores = new Map();
	}

	protected createResultStream(debugInfo: QueryDebugInfo) {
		const self = this; // eslint-disable-line @typescript-eslint/no-this-alias
		let last = Date.now();
		return new Transform({
			highWaterMark: 1024, // buffer up to 1024 messages
			objectMode: true,
			transform(row: types.Row, _, done) {
				const now = Date.now();
				const message = self.parseRow(debugInfo)(row);
				if (message !== null) {
					this.push(message);
				}
				// To avoid blocking main thread for too long, after every 100ms
				// pause & resume the cassandraStream to give other events in the event
				// queue a chance to be handled.
				if (now - last > 100) {
					setImmediate(() => {
						last = Date.now();
						done();
					});
				} else {
					done();
				}
			},
		});
	}

	private queryWithStreamingResults(query: string, queryParams: any[]) {
		return this.cassandraClient.stream(query, queryParams, {
			prepare: true,
			// Note #1
			// force small page sizes, otherwise gives RangeError [ERR_OUT_OF_RANGE]: The value of "offset" is out of range.
			//
			// Note #2
			// Fetch size also plays an important role at how much data is overfetched.
			// For example, if fetchSize is 100, and the stream is ended after 40 messages
			// then we will have 60 messages overfetched.
			// It's important we use to end our streams after a certain number of messages
			// And smaller fetch sizes will help us reduce the number of overfetched messages at DB level, at
			// tradeoff of more roundtrips to DB.
			fetchSize: 128,
			readTimeout: 0,
		}) as Readable;
	}

	async store(streamMessage: StreamMessage): Promise<boolean> {
		logger.debug('Store message');

		const bucketId = this.bucketManager.getBucketId(
			streamMessage.getStreamId(),
			streamMessage.getStreamPartition(),
			streamMessage.getTimestamp()
		);

		return new Promise((resolve, reject) => {
			if (bucketId) {
				logger.trace(`found bucketId: ${bucketId}`);

				const record = {
					streamId: streamMessage.getStreamId(),
					partition: streamMessage.getStreamPartition(),
					timestamp: streamMessage.getTimestamp(),
					sequenceNo: streamMessage.getSequenceNumber(),
					publisherId: streamMessage.getPublisherId(),
					msgChainId: streamMessage.getMsgChainId(),
					payload: Buffer.from(convertStreamMessageToBytes(streamMessage)),
				};
				this.bucketManager.incrementBucket(bucketId, record.payload.length);
				setImmediate(() =>
					this.batchManager.store(bucketId, record, (err?: Error) => {
						if (err) {
							reject(err);
						} else {
							this.emit('write', record.payload);
							resolve(true);
						}
					})
				);
			} else {
				logger.trace('Move message to pending messages (bucket not found)', {
					messageId: JSON.stringify(streamMessage.messageId),
				});

				const uuid = uuidv1();
				const timeout = setTimeout(() => {
					this.pendingStores.delete(uuid);
					this.store(streamMessage).then(resolve, reject);
				}, this.commonOpts.retriesIntervalMilliseconds!);
				this.pendingStores.set(uuid, timeout);
			}
		});
	}

	public queryRange(
		streamId: string,
		partition: number,
		fromTimestamp: number,
		fromSequenceNo: number,
		toTimestamp: number,
		toSequenceNo: number,
		publisherId?: string,
		msgChainId?: string,
		limit?: number
	): Readable {
		const resultStream = this.createResultStream({
			streamId,
			partition,
			fromTimestamp,
			fromSequenceNo,
			toTimestamp,
			toSequenceNo,
			publisherId,
			msgChainId,
		});

		this.getBucketsByTimestamp(streamId, partition, fromTimestamp, toTimestamp)
			.then((buckets: Bucket[]) => {
				if (buckets.length === 0) {
					resultStream.end();
					return;
				}

				const bucketIds = bucketsToIds(buckets);

				let queries: {
					queryStatement: string;
					params: any[];
					limit?: string;
				}[];
				// optimize the typical case where the sequenceNumber doesn't filter out anything
				if (
					fromSequenceNo === MIN_SEQUENCE_NUMBER_VALUE &&
					toSequenceNo === MAX_SEQUENCE_NUMBER_VALUE
				) {
					queries = [
						{
							queryStatement:
								'WHERE stream_id = ? AND partition = ? AND bucket_id IN ? AND ts >= ? AND ts <= ?',
							params: [
								streamId,
								partition,
								bucketIds,
								fromTimestamp,
								toTimestamp,
							],
						},
					];
				} else if (fromTimestamp === toTimestamp) {
					queries = [
						{
							queryStatement:
								'WHERE stream_id = ? AND partition = ? AND bucket_id IN ? AND ts = ? AND sequence_no >= ? AND sequence_no <= ?',
							params: [
								streamId,
								partition,
								bucketIds,
								fromTimestamp,
								fromSequenceNo,
								toSequenceNo,
							],
						},
					];
				} else {
					queries = [
						{
							queryStatement:
								'WHERE stream_id = ? AND partition = ? AND bucket_id IN ? AND ts = ? AND sequence_no >= ?',
							params: [
								streamId,
								partition,
								bucketIds,
								fromTimestamp,
								fromSequenceNo,
							],
						},
						{
							queryStatement:
								'WHERE stream_id = ? AND partition = ? AND bucket_id IN ? AND ts > ? AND ts < ?',
							params: [
								streamId,
								partition,
								bucketIds,
								fromTimestamp,
								toTimestamp,
							],
						},
						{
							queryStatement:
								'WHERE stream_id = ? AND partition = ? AND bucket_id IN ? AND ts = ? AND sequence_no <= ?',
							params: [
								streamId,
								partition,
								bucketIds,
								toTimestamp,
								toSequenceNo,
							],
						},
					];
				}

				queries.forEach((q) => {
					if (publisherId) {
						q.queryStatement += ' AND publisher_id = ?';
						q.params.push(publisherId);
					}
					if (msgChainId) {
						q.queryStatement += ' AND msg_chain_id = ?';
						q.params.push(msgChainId);
					}

					///
					// Explanation on setting limit for each query:
					//
					// We know that setting limit for each query is not enough to guarantee the total number of messages returned.
					// Mainly because there multiple queries, and we can't merge the results at DB side, sort and then limit.
					//
					// But this is done to reduce the number of messages returned from each query, and thus reduce the memory usage
					// on Cassandra DB side, even if there are way more messages on the query result.
					//
					// To make sure that the total number of messages returned is not more than the limit, the result stream
					// will also have another mechanism to limit the number of messages returned.
					if (limit) {
						q.queryStatement += ` LIMIT ?`;
						q.params.push(limit);
					}
				});

				const streams = queries.map((q) => {
					const select = `SELECT payload
													FROM stream_data ${q.queryStatement} ALLOW FILTERING`;

					return this.queryWithStreamingResults(select, q.params);
				});

				return pipeline(
					// @ts-expect-error options not in type
					merge2(...streams, {
						pipeError: true,
					}),
					resultStream,
					(err: Error | null) => {
						if (err) {
							resultStream.destroy(err);
							streams.forEach((s) => s.destroy(undefined));
						}
					}
				);
			})
			.catch((e) => {
				resultStream.destroy(e);
			});

		return resultStream;
	}

	public queryLast(
		streamId: string,
		partition: number,
		requestCount: number
	): Readable {
		if (requestCount < 0) {
			throw new Error('requestCount must be positive');
		}

		return this.queryTake(streamId, partition, -requestCount);
	}

	public queryFirst(
		streamId: string,
		partition: number,
		requestCount: number
	): Readable {
		if (requestCount < 0) {
			throw new Error('requestCount must be positive');
		}

		return this.queryTake(streamId, partition, requestCount);
	}

	queryTake(
		streamId: string,
		partition: number,
		// if positive, is first messages, if negative, is last messages
		requestCount: number
	): Readable {
		const requestType = requestCount > 0 ? 'first' : 'last';
		const orderByForLastMessage = 'ORDER BY ts DESC, sequence_no DESC ';
		const orderByForFirstMessage = 'ORDER BY ts ASC, sequence_no ASC ';
		const messagesCount = Math.abs(requestCount);

		const limit = Math.min(messagesCount, MAX_RESEND_LAST);

		logger.trace('requestLast', { streamId, partition, limit });

		const GET_N_MESSAGES =
			'SELECT payload FROM stream_data WHERE ' +
			'stream_id = ? AND partition = ? AND bucket_id IN ? ' +
			(requestType === 'first'
				? orderByForFirstMessage
				: orderByForLastMessage) +
			'LIMIT ?';
		const COUNT_MESSAGES =
			'SELECT COUNT(*) AS total FROM stream_data WHERE stream_id = ? AND partition = ? AND bucket_id = ?';
		const GET_BUCKETS =
			'SELECT id FROM bucket WHERE stream_id = ? AND partition = ?';

		let total = 0;
		const options = {
			prepare: true,
			fetchSize: 1,
		};

		const resultStream = this.createResultStream({
			streamId,
			partition,
			limit,
		});

		const makeTakeQuery = async (bucketIds: BucketId[]) => {
			try {
				const params = [streamId, partition, bucketIds, limit];
				const resultSet = await this.cassandraClient.execute(
					GET_N_MESSAGES,
					params,
					{
						prepare: true,
						fetchSize: 0, // disable paging
					}
				);
				const orderedRows =
					requestType === 'first' ? resultSet.rows : resultSet.rows.reverse();
				orderedRows.forEach((r: types.Row) => {
					resultStream.write(r);
				});
				resultStream.end();
			} catch (err) {
				resultStream.destroy(err);
			}
		};

		let bucketId: BucketId;
		const bucketIds: BucketId[] = [];
		/**
		 * Process:
		 * - get latest bucketId => count number of messages in this bucket
		 * - if enough => get all messages and return
		 * - if not => move to the next bucket and repeat cycle
		 */
		this.cassandraClient.eachRow(
			GET_BUCKETS,
			[streamId, partition],
			options,
			(_n, row: types.Row) => {
				bucketId = row.id;
				bucketIds.push(bucketId);
			},
			async (err: Error | undefined, result: types.ResultSet) => {
				// do nothing if resultStream ended
				if (resultStream.writableEnded || resultStream.readableEnded) {
					return;
				}
				if (err) {
					resultStream.destroy(err);
				} else {
					// no buckets found at all
					if (!bucketId) {
						resultStream.end();
						return;
					}
					try {
						// get total stored message in bucket
						const resultSet = await this.cassandraClient.execute(
							COUNT_MESSAGES,
							[streamId, partition, bucketId],
							{
								prepare: true,
								fetchSize: 0, // disable paging
							}
						);
						const row = resultSet.first();
						total += row.total.low;

						// if not enough messages and we next page exists, repeat eachRow
						if (result.nextPage && total < limit && total < MAX_RESEND_LAST) {
							result.nextPage();
						} else {
							makeTakeQuery(bucketIds);
						}
					} catch (err2) {
						resultStream.destroy(err2);
					}
				}
			}
		);

		return resultStream;
	}

	public queryByMessageRefs(
		streamId: string,
		partition: number,
		messageRefs: MessageRef[]
	): Readable {
		const sourceStream = Readable.from(messageRefs);

		const resultStream = this.createResultStream({
			streamId,
			partition,
			messageRefs,
		});

		const transfrom = new Transform({
			objectMode: true,
			transform: async (messageRef: MessageRef, _, done) => {
				const [bucket] = await this.getBucketsByTimestamp(
					streamId,
					partition,
					messageRef.timestamp,
					messageRef.timestamp
				);
				if (!bucket) {
					logger.warn(`Bucket not found for messageRef`, {
						messageRef,
					});
					done();
					return;
				}

				const query =
					'SELECT payload FROM stream_data WHERE ' +
					'stream_id = ? AND partition = ? AND bucket_id = ? AND ts = ? AND sequence_no = ?';
				const params = [
					streamId,
					partition,
					bucket.id,
					messageRef.timestamp,
					messageRef.sequenceNumber,
				];

				const resultSet = await this.cassandraClient.execute(query, params, {
					prepare: true,
				});

				if (!resultSet.rows[0]) {
					logger.warn('Message not found for messageRef', {
						messageRef,
					});
					done();
					return;
				}

				done(null, resultSet.rows[0]);
			},
		});

		return pipeline(
			sourceStream,
			transfrom,
			resultStream,
			(err: Error | null) => {
				if (err) {
					sourceStream.destroy();
					transfrom.destroy();
					resultStream.destroy(err);
				}
			}
		);
	}

	async getTotalBytesInStream(
		streamId: string,
		partition: number
	): Promise<number> {
		const query =
			'SELECT SUM(size) as count FROM bucket WHERE stream_id=? AND partition=?';
		const queryParams = [streamId, partition];
		const res = await this.cassandraClient.execute(query, queryParams, {
			prepare: true,
		});

		if (res.rows.length !== 1) {
			return 0;
		}

		let { count } = res.rows[0];

		// Cassandra's integer has overflown, calculate fetching row by row
		if (count < 0) {
			count = 0;

			const queryOverflown =
				'SELECT size FROM bucket WHERE stream_id=? AND partition=?';
			const queryParamsOverflown = [streamId, partition];

			const resOverflown = await this.cassandraClient.execute(
				queryOverflown,
				queryParamsOverflown,
				{
					prepare: true,
				}
			);

			for (const row of resOverflown.rows) {
				count += row.size;
			}
		}

		return count;
	}

	async getNumberOfMessagesInStream(
		streamId: string,
		partition: number
	): Promise<number> {
		const query =
			'SELECT SUM(records) as count FROM bucket WHERE stream_id=? AND partition=?';
		const queryParams = [streamId, partition];

		const res = await this.cassandraClient.execute(query, queryParams, {
			prepare: true,
		});

		if (res.rows.length !== 1) {
			return 0;
		}

		const { count } = res.rows[0];

		return count;
	}

	async getLastMessageDateInStream(
		streamId: string,
		partition: number
	): Promise<number | null> {
		const bucketQuery =
			'SELECT id FROM bucket WHERE stream_id=? AND partition =? ORDER BY date_create DESC LIMIT 1';

		const queryParams = [streamId, partition];

		const buckets = await this.cassandraClient.execute(
			bucketQuery,
			queryParams,
			{
				prepare: true,
			}
		);

		if (buckets.rows.length !== 1) {
			return null;
		}

		const bucketId = buckets.rows[0].id;

		const query =
			'SELECT ts FROM stream_data WHERE stream_id=? AND partition=? AND bucket_id=? ORDER BY ts DESC LIMIT 1';

		const streams = await this.cassandraClient.execute(
			query,
			[streamId, partition, bucketId],
			{
				prepare: true,
			}
		);

		return streams.rows[0]?.ts ?? null;
	}

	async getFirstMessageDateInStream(
		streamId: string,
		partition: number
	): Promise<number | null> {
		const bucketQuery =
			'SELECT id FROM bucket WHERE stream_id=? AND partition =? ORDER BY date_create ASC LIMIT 1';

		const queryParams = [streamId, partition];

		const buckets = await this.cassandraClient.execute(
			bucketQuery,
			queryParams,
			{
				prepare: true,
			}
		);

		if (buckets.rows.length !== 1) {
			return null;
		}

		const bucketId = buckets.rows[0].id;

		const query =
			'SELECT ts FROM stream_data WHERE stream_id=? AND partition=? AND bucket_id=? ORDER BY ts ASC LIMIT 1';

		const streams = await this.cassandraClient.execute(
			query,
			[streamId, partition, bucketId],
			{
				prepare: true,
			}
		);

		return streams.rows[0]?.ts;
	}

	public async start(): Promise<void> {
		const nbTrials = 20;
		let retryCount = nbTrials;
		let lastError = '';
		while (retryCount > 0) {
			/* eslint-disable no-await-in-loop */
			try {
				await this.cassandraClient.connect().catch((err) => {
					throw err;
				});
				return;
			} catch (err) {
				// eslint-disable-next-line no-console
				console.log('Cassandra not responding yet...');
				retryCount -= 1;
				await sleep(5000);
				lastError = err;
			}
			/* eslint-enable no-await-in-loop */
		}
		throw new Error(
			`Failed to connect to Cassandra after ${nbTrials} trials: ${lastError.toString()}`
		);
	}

	// =============== BUCKETS ===============
	private async getBucketsFromDatabase(
		query: string,
		params: any,
		streamId: string,
		partition: number
	): Promise<Bucket[]> {
		const buckets: Bucket[] = [];

		const resultSet = await this.cassandraClient.execute(query, params, {
			prepare: true,
		});

		resultSet.rows.forEach((row) => {
			const { id, records, size, date_create: dateCreate } = row;

			const bucket = this.bucketManager.createBucketWithManagerConfigs(
				id.toString(),
				streamId,
				partition,
				size,
				records,
				new Date(dateCreate)
			);

			buckets.push(bucket);
		});

		return buckets;
	}

	/**
	 * Get buckets by timestamp range or all known from some timestamp or all buckets before some timestamp
	 *
	 * @param streamId
	 * @param partition
	 * @param fromTimestamp
	 * @param toTimestamp
	 * @returns {Promise<[]>}
	 */
	async getBucketsByTimestamp(
		streamId: string,
		partition: number,
		fromTimestamp: number | undefined = undefined,
		toTimestamp: number | undefined = undefined
	): Promise<Bucket[]> {
		const getExplicitFirst = () => {
			// if fromTimestamp is defined, the first data point are in a some earlier bucket
			// (bucket.dateCreated<=fromTimestamp as data within one millisecond won't be divided to multiple buckets)
			const QUERY =
				'SELECT * FROM bucket WHERE stream_id = ? and partition = ? AND date_create <= ? ORDER BY date_create DESC LIMIT 1';
			const params = [streamId, partition, fromTimestamp];
			return this.getBucketsFromDatabase(QUERY, params, streamId, partition);
		};

		const getRest = () => {
			/* eslint-disable max-len */
			const GET_LAST_BUCKETS_RANGE_TIMESTAMP =
				'SELECT * FROM bucket WHERE stream_id = ? and partition = ? AND date_create > ? AND date_create <= ? ORDER BY date_create DESC';
			const GET_LAST_BUCKETS_FROM_TIMESTAMP =
				'SELECT * FROM bucket WHERE stream_id = ? and partition = ? AND date_create > ? ORDER BY date_create DESC';
			const GET_LAST_BUCKETS_TO_TIMESTAMP =
				'SELECT * FROM bucket WHERE stream_id = ? and partition = ? AND date_create <= ? ORDER BY date_create DESC';
			let query;
			let params;
			if (fromTimestamp !== undefined && toTimestamp !== undefined) {
				query = GET_LAST_BUCKETS_RANGE_TIMESTAMP;
				params = [streamId, partition, fromTimestamp, toTimestamp];
			} else if (fromTimestamp !== undefined && toTimestamp === undefined) {
				query = GET_LAST_BUCKETS_FROM_TIMESTAMP;
				params = [streamId, partition, fromTimestamp];
			} else if (fromTimestamp === undefined && toTimestamp !== undefined) {
				query = GET_LAST_BUCKETS_TO_TIMESTAMP;
				params = [streamId, partition, toTimestamp];
			} else {
				throw TypeError(
					`Not correct combination of fromTimestamp (${fromTimestamp}) and toTimestamp (${toTimestamp})`
				);
			}
			return this.getBucketsFromDatabase(query, params, streamId, partition);
		};

		if (fromTimestamp !== undefined) {
			return Promise.all([getExplicitFirst(), getRest()]).then(
				([first, rest]) => rest.concat(first)
			);
		} else {
			// eslint-disable-line no-else-return
			return getRest();
		}
	}

	/**
	 * Get latest N buckets or get latest N buckets before some date (to check buckets in the past)
	 *
	 * @param streamId
	 * @param partition
	 * @param limit
	 * @param timestamp
	 * @returns {Promise<[]>}
	 */
	async getLastBuckets(
		streamId: string,
		partition: number,
		limit = 1,
		timestamp: number | undefined = undefined
	): Promise<Bucket[]> {
		const GET_LAST_BUCKETS =
			'SELECT * FROM bucket WHERE stream_id = ? and partition = ?  ORDER BY date_create DESC LIMIT ?';
		const GET_LAST_BUCKETS_TIMESTAMP =
			'SELECT * FROM bucket WHERE stream_id = ? and partition = ? AND date_create <= ? ORDER BY date_create DESC LIMIT ?';

		let query;
		let params;

		if (timestamp) {
			query = GET_LAST_BUCKETS_TIMESTAMP;
			params = [streamId, partition, timestamp, limit];
		} else {
			query = GET_LAST_BUCKETS;
			params = [streamId, partition, limit];
		}

		return this.getBucketsFromDatabase(query, params, streamId, partition);
	}

	public async upsertBucket(
		bucket: Bucket
	): Promise<{ bucket: Bucket; records: number }> {
		// for non-existing buckets UPDATE works as INSERT
		const UPDATE_BUCKET =
			'UPDATE bucket SET size = ?, records = ?, id = ? WHERE stream_id = ? AND partition = ? AND date_create = ?';

		const { id, size, records, streamId, partition, dateCreate } = bucket;
		const params = [size, records, id, streamId, partition, dateCreate];

		await this.cassandraClient.execute(UPDATE_BUCKET, params, {
			prepare: true,
		});
		return {
			bucket,
			records,
		};
	}

	public async stop() {
		const keys = [...this.pendingStores.keys()];
		keys.forEach((key) => {
			const timeout = this.pendingStores.get(key);
			clearTimeout(timeout!);
			this.pendingStores.delete(key);
		});

		this.bucketManager.stop();
		this.batchManager.stop();
		this.removeAllListeners();
		return this.cassandraClient.shutdown();
	}
}
