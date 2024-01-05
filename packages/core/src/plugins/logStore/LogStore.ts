import { MessageID, StreamMessage } from '@streamr/protocol';
import { Logger, MetricsContext, RateMetric } from '@streamr/utils';
import { Readable } from 'stream';

import { BucketManagerOptions } from './BucketManager';
import {
	CassandraDBAdapter,
	CassandraDBOptions,
} from './database/CassandraDBAdapter';
import {
	DatabaseAdapter,
	DatabaseEventEmitter,
} from './database/DatabaseAdapter';
import { SQLiteDBOptions } from './database/SQLiteDBAdapter';
import { MessageLimitTransform } from './http/dataTransformers';


const logger = new Logger(module);

// TODO: move this to protocol-js
export const MIN_SEQUENCE_NUMBER_VALUE = 0;
export const MAX_SEQUENCE_NUMBER_VALUE = 2147483647;
const MAX_TIMESTAMP_VALUE = 8640000000000000; // https://262.ecma-international.org/5.1/#sec-15.9.1.1

export type DatabaseOptions = CassandraDBOptions | SQLiteDBOptions;

export type CommonDBOptions = Partial<BucketManagerOptions> & {
	useTtl?: boolean;
	retriesIntervalMilliseconds?: number;
};

const getOptionsWithDefaults = <T extends CommonDBOptions>(opts: T): T => {
	const defaultOptions = {
		useTtl: false,
		retriesIntervalMilliseconds: 500,
	};
	return {
		...defaultOptions,
		...opts,
	};
};

export class LogStore extends DatabaseEventEmitter {
	constructor(private db: DatabaseAdapter) {
		super();

		this.db.on('read', (p) => this.emit('read', p));
		this.db.on('write', (p) => this.emit('write', p));
	}

	async store(streamMessage: StreamMessage): Promise<boolean> {
		logger.debug('Store message');

		return this.db.store(streamMessage);
	}

	requestLast(
		streamId: string,
		partition: number,
		requestCount: number
	): Readable {
		return this.db.queryLast(streamId, partition, requestCount);
	}

	requestFrom(
		streamId: string,
		partition: number,
		fromTimestamp: number,
		fromSequenceNo: number,
		publisherId?: string,
		limit?: number
	): Readable {
		logger.trace('requestFrom %o', {
			streamId,
			partition,
			fromTimestamp,
			fromSequenceNo,
			publisherId,
			limit,
		});

		const messageLimitTransform = new MessageLimitTransform(limit || Infinity);

		return this.db
			.queryRange(
				streamId,
				partition,
				fromTimestamp,
				fromSequenceNo,
				MAX_TIMESTAMP_VALUE,
				MAX_SEQUENCE_NUMBER_VALUE,
				publisherId,
				undefined,
				limit
			)
			.pipe(messageLimitTransform);
	}

	/**
	 * Requests data from the DB using the serialized message ID.
	 */
	requestByMessageId(messageIdSerialized: string): Readable {
		return this.requestByMessageIds([messageIdSerialized]);
	}

	/**
	 * Requests messages from DB by their serialized message IDs.
	 */
	requestByMessageIds(messageIdsSerialized: string[]): Readable {
		const messageIds = messageIdsSerialized.map((messageId) =>
			// @ts-expect-error Property 'fromArray' does not exist on type 'typeof MessageID'
			MessageID.fromArray(JSON.parse(messageId))
		);

		return this.db.queryByMessageIds(messageIds);
	}

	requestRange(
		streamId: string,
		partition: number,
		fromTimestamp: number,
		fromSequenceNo: number,
		toTimestamp: number,
		toSequenceNo: number,
		publisherId: string | undefined,
		msgChainId: string | undefined,
		limit?: number
	): Readable {
		logger.trace('requestRange %o', {
			streamId,
			partition,
			fromTimestamp,
			fromSequenceNo,
			toTimestamp,
			toSequenceNo,
			publisherId,
			msgChainId,
			limit,
		});

		// TODO is there any reason why we shouldn't allow range queries which contain publisherId, but not msgChainId?
		// (or maybe even queries with msgChain but without publisherId)
		const isValidRequest =
			(publisherId !== undefined && msgChainId !== undefined) ||
			(publisherId === undefined && msgChainId === undefined);
		if (!isValidRequest) {
			throw new Error('Invalid combination of requestFrom arguments');
		}
		return this.db.queryRange(
			streamId,
			partition,
			fromTimestamp,
			fromSequenceNo,
			toTimestamp,
			toSequenceNo,
			publisherId,
			msgChainId,
			limit
		);
	}

	enableMetrics(metricsContext: MetricsContext): void {
		const metrics = {
			readMessagesPerSecond: new RateMetric(),
			readBytesPerSecond: new RateMetric(),
			writeMessagesPerSecond: new RateMetric(),
			writeBytesPerSecond: new RateMetric(),
		};
		metricsContext.addMetrics('broker.plugin.logStore', metrics);
		this.on('read', (streamMessage: StreamMessage) => {
			metrics.readMessagesPerSecond.record(1);
			metrics.readBytesPerSecond.record(streamMessage.getContent(false).length);
		});
		this.on('write', (streamMessage: StreamMessage) => {
			metrics.writeMessagesPerSecond.record(1);
			metrics.writeBytesPerSecond.record(
				streamMessage.getContent(false).length
			);
		});
	}

	async getFirstMessageTimestampInStream(
		streamId: string,
		partition: number
	): Promise<number> {
		const firstMessageDateInStream = await this.db.getFirstMessageDateInStream(
			streamId,
			partition
		);
		return firstMessageDateInStream
			? new Date(firstMessageDateInStream).getTime()
			: 0;
	}

	async getLastMessageTimestampInStream(
		streamId: string,
		partition: number
	): Promise<number> {
		const lastMessageDateInStream = await this.db.getLastMessageDateInStream(
			streamId,
			partition
		);
		return lastMessageDateInStream
			? new Date(lastMessageDateInStream).getTime()
			: 0;
	}

	async getNumberOfMessagesInStream(
		streamId: string,
		partition: number
	): Promise<number> {
		return this.db.getNumberOfMessagesInStream(streamId, partition);
	}

	async getTotalBytesInStream(
		streamId: string,
		partition: number
	): Promise<number> {
		return this.db.getTotalBytesInStream(streamId, partition);
	}

	public async close(): Promise<void> {
		await this.db.stop();
	}
}

const getDbFromOpts = (
	dbOpts: DatabaseOptions,
	commonOpts: CommonDBOptions
): DatabaseAdapter => {
	const commonOptsWithDefaults = getOptionsWithDefaults(commonOpts);
	switch (dbOpts.type) {
		case 'cassandra':
			return new CassandraDBAdapter(dbOpts, commonOptsWithDefaults);
		default:
			throw new Error(`Unknown database type: ${dbOpts.type}`);
	}
};
export const startLogStore = async (
	dbOpts: DatabaseOptions,
	commonOpts: CommonDBOptions
): Promise<LogStore> => {
	const db = getDbFromOpts(dbOpts, commonOpts);
	await db.start();
	return new LogStore(db);
};
