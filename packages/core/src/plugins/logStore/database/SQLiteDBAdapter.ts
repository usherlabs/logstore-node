import { MessageID, StreamMessage } from '@streamr/protocol';
import { Logger } from '@streamr/utils';
import Database from 'better-sqlite3';
import {
	and,
	asc,
	between,
	count,
	desc,
	eq,
	gt,
	gte,
	lt,
	lte,
	or,
	placeholder,
	sum,
} from 'drizzle-orm';
import { BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { getTableName } from 'drizzle-orm/table';
import fs from 'fs';
import path from 'path';
import { concatAll, firstValueFrom, from, map, mergeAll } from 'rxjs';
import { Readable } from 'stream';

import {
	MAX_SEQUENCE_NUMBER_VALUE,
	MIN_SEQUENCE_NUMBER_VALUE,
} from '../LogStore';
import { DatabaseAdapter } from './DatabaseAdapter';
import {
	createTableStatement,
	streamDataTable,
	tableExists,
} from './sqlite/tables';

const logger = new Logger(module);

export interface SQLiteDBOptions {
	type: 'sqlite';
	dataPath: string;
}

export class SQLiteDBAdapter extends DatabaseAdapter {
	private dbClient: BetterSQLite3Database;
	private dbInstance: Database.Database;

	constructor(opts: SQLiteDBOptions) {
		super();

		// 2 options:
		// user define data path starting with /, treat as absolute
		// e.g.:  /home/node/.logstore/data.db
		// otherwise, without /, treat as relative from currently working directory
		// e.g.: .logstore/data.db -> cwd + .logstore/data.db
		const absolutePath =
			opts.dataPath.startsWith('/') || opts.dataPath.startsWith(':')
				? opts.dataPath
				: path.resolve(process.cwd(), opts.dataPath);

		logger.info(`Setting up SQLite database at ${absolutePath}`);

		// otherwise could be :memory:
		if (!fs.existsSync(absolutePath) && !absolutePath.startsWith(':')) {
			createDirIfNotExists(absolutePath);
		}

		this.dbInstance = new Database(absolutePath);
		this.dbInstance.pragma('journal_mode = WAL');

		this.dbClient = drizzle(this.dbInstance);

		this.ensureTablesExist();
	}

	// check if defined database has all tables already created, and creates if needed
	private ensureTablesExist() {
		const tableName = getTableName(streamDataTable);
		if (!tableExists(tableName, this.dbClient)) {
			logger.info(`Creating table ${tableName} in SQLite database`);
			this.dbClient.run(createTableStatement);
		}
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
		const getTemporalConditionSlices = () => {
			//
			switch (true) {
				case fromSequenceNo === MIN_SEQUENCE_NUMBER_VALUE &&
					toSequenceNo === MAX_SEQUENCE_NUMBER_VALUE:
					return between(streamDataTable.ts, fromTimestamp, toTimestamp);
				case fromTimestamp === toTimestamp:
					return and(
						eq(streamDataTable.ts, fromTimestamp),
						between(streamDataTable.sequence_no, fromSequenceNo, toSequenceNo)
					);
				default:
					return or(
						and(
							eq(streamDataTable.ts, fromTimestamp),
							gte(streamDataTable.sequence_no, fromSequenceNo)
						),
						and(
							gt(streamDataTable.ts, fromTimestamp),
							lt(streamDataTable.ts, toTimestamp)
						),
						and(
							eq(streamDataTable.ts, toTimestamp),
							lte(streamDataTable.sequence_no, toSequenceNo)
						)
					);
			}
		};

		let query = this.dbClient
			.select({
				payload: streamDataTable.payload,
			})
			.from(streamDataTable)
			.where(
				and(
					eq(streamDataTable.stream_id, streamId),
					eq(streamDataTable.partition, partition),
					getTemporalConditionSlices(),
					publisherId
						? eq(streamDataTable.publisher_id, publisherId)
						: undefined,
					msgChainId ? eq(streamDataTable.msg_chain_id, msgChainId) : undefined
				)
			)
			.orderBy(asc(streamDataTable.ts), asc(streamDataTable.sequence_no))
			.$dynamic();

		if (limit) {
			query = query.limit(limit);
		}

		const preparedQuery = query.prepare();

		// we do this to avoid blocking the event loop
		// otherwise, when consuming using .all, .get, it's synchronous and blocks
		const results$ = from(preparedQuery.execute()).pipe(
			mergeAll(),
			map(
				this.parseRow({
					streamId,
					partition,
					fromTimestamp,
					fromSequenceNo,
					toTimestamp,
					toSequenceNo,
					publisherId,
					msgChainId,
					limit,
				})
			)
		);

		return Readable.from(results$);
	}

	public queryLast(
		streamId: string,
		partition: number,
		requestCount: number
	): Readable {
		return this.queryTake(streamId, partition, requestCount * -1);
	}

	public queryFirst(
		streamId: string,
		partition: number,
		requestCount: number
	): Readable {
		return this.queryTake(streamId, partition, requestCount);
	}

	private queryTake(
		streamId: string,
		partition: number,
		// if positive, is first messages, if negative, is last messages
		requestCount: number
	): Readable {
		const requestType = requestCount > 0 ? 'first' : 'last';
		const orderByForLastMessage = [
			desc(streamDataTable.ts),
			desc(streamDataTable.sequence_no),
		];
		const orderByForFirstMessage = [
			asc(streamDataTable.ts),
			asc(streamDataTable.sequence_no),
		];

		const messagesCount = Math.abs(requestCount);

		const preparedQuery = this.dbClient
			.select({
				payload: streamDataTable.payload,
			})
			.from(streamDataTable)
			.where(
				and(
					eq(streamDataTable.stream_id, streamId),
					eq(streamDataTable.partition, partition)
				)
			)
			.orderBy(
				...(requestType === 'last'
					? orderByForLastMessage
					: orderByForFirstMessage)
			)
			.limit(messagesCount)
			.prepare();

		const results$ = from(preparedQuery.execute()).pipe(
			// reverse if we want the last messages, but don't if we want the first
			map((c) => (requestType === 'last' ? c.reverse() : c)),
			mergeAll(), // array to values
			map(
				this.parseRow({
					streamId,
					partition,
					limit: requestCount,
				})
			)
		);

		return Readable.from(results$);
	}

	public queryByMessageIds(messageIds: MessageID[]): Readable {
		// optimized when using prepared + placeholder
		// see https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-core/README.md#%EF%B8%8F-performance-and-prepared-statements
		const queryTemplate = this.dbClient
			.select({
				payload: streamDataTable.payload,
			})
			.from(streamDataTable)
			.where(
				and(
					eq(streamDataTable.stream_id, placeholder('stream_id')),
					eq(streamDataTable.partition, placeholder('partition')),
					eq(streamDataTable.ts, placeholder('ts')),
					eq(streamDataTable.sequence_no, placeholder('sequence_no')),
					eq(streamDataTable.publisher_id, placeholder('publisher_id')),
					eq(streamDataTable.msg_chain_id, placeholder('msg_chain_id'))
				)
			)
			.prepare();

		const queries = messageIds.map((messageId) =>
			queryTemplate.execute({
				stream_id: messageId.streamId,
				partition: messageId.streamPartition,
				ts: messageId.timestamp,
				sequence_no: messageId.sequenceNumber,
				publisher_id: messageId.publisherId,
				msg_chain_id: messageId.msgChainId,
			})
		);

		const results$ = from(queries).pipe(
			concatAll(), // promises to arrays, preserving the order
			mergeAll(), // arrays to values
			map(
				this.parseRow({
					messageIds: messageIds.map((m) => m.serialize()),
				})
			)
		);

		return Readable.from(results$);
	}

	public async store(streamMessage: StreamMessage): Promise<boolean> {
		await this.dbClient.insert(streamDataTable).values({
			stream_id: streamMessage.getStreamId(),
			partition: streamMessage.getStreamPartition(),
			ts: streamMessage.getTimestamp(),
			sequence_no: streamMessage.getSequenceNumber(),
			publisher_id: streamMessage.getPublisherId(),
			msg_chain_id: streamMessage.getMsgChainId(),
			payload: JSON.parse(streamMessage.serialize()),
			content_bytes: Buffer.byteLength(streamMessage.serialize()),
		});

		this.emit('write', streamMessage);

		return true;
	}

	getTotalBytesInStream(streamId: string, partition: number): Promise<number> {
		const preparedQuery = this.dbClient
			.select({
				totalBytes: sum(streamDataTable.content_bytes).mapWith(Number),
			})
			.from(streamDataTable)
			.having(
				and(
					eq(streamDataTable.stream_id, streamId),
					eq(streamDataTable.partition, partition)
				)
			)
			.prepare();

		const results$ = from(preparedQuery.execute()).pipe(
			mergeAll(),
			map((c) => c.totalBytes)
		);

		return firstValueFrom(results$);
	}

	getLastMessageDateInStream(
		streamId: string,
		partition: number
	): Promise<number | null> {
		const preparedQuery = this.dbClient
			.select({
				ts: streamDataTable.ts,
			})
			.from(streamDataTable)
			.where(
				and(
					eq(streamDataTable.stream_id, streamId),
					eq(streamDataTable.partition, partition)
				)
			)
			.orderBy(desc(streamDataTable.ts), desc(streamDataTable.sequence_no))
			.limit(1)
			.prepare();

		const results$ = from(preparedQuery.execute()).pipe(
			mergeAll(),
			map((m) => m.ts)
		);

		return firstValueFrom(results$);
	}

	getFirstMessageDateInStream(
		streamId: string,
		partition: number
	): Promise<number | null> {
		const preparedQuery = this.dbClient
			.select({
				ts: streamDataTable.ts,
			})
			.from(streamDataTable)
			.where(
				and(
					eq(streamDataTable.stream_id, streamId),
					eq(streamDataTable.partition, partition)
				)
			)
			.orderBy(asc(streamDataTable.ts))
			.limit(1)
			.prepare();

		const results$ = from(preparedQuery.execute()).pipe(
			mergeAll(),
			map((m) => m.ts)
		);

		return firstValueFrom(results$);
	}

	getNumberOfMessagesInStream(
		streamId: string,
		partition: number
	): Promise<number> {
		const preparedQuery = this.dbClient
			.select({
				count: count(streamDataTable.stream_id),
			})
			.from(streamDataTable)
			.having(
				and(
					eq(streamDataTable.stream_id, streamId),
					eq(streamDataTable.partition, partition)
				)
			)
			.prepare();

		const results$ = from(preparedQuery.execute()).pipe(
			mergeAll(),
			map((c) => c.count)
		);

		return firstValueFrom(results$);
	}

	async start(): Promise<void> {}

	async stop(): Promise<void> {
		this.dbInstance.close();
	}
}

const createDirIfNotExists = (filePath: string) => {
	const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
	}
};
