import { MessageID, StreamMessage } from '@streamr/protocol';
import Database from 'better-sqlite3';
import {
	and,
	between,
	desc,
	eq,
	gt,
	gte,
	lt,
	lte,
	or,
	placeholder,
} from 'drizzle-orm';
import { BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { getTableName } from 'drizzle-orm/table';
import fs from 'fs';
import { concatAll, forkJoin, from, map, mergeAll } from 'rxjs';
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

export interface SQLiteDBOptions {
	type: 'sqlite';
	dataPath: string;
}

export class SQLiteDBAdapter extends DatabaseAdapter {
	private dbClient: BetterSQLite3Database;
	private dbInstance: Database.Database;

	constructor(opts: SQLiteDBOptions) {
		super();

		// otherwise could be :memory:
		if (!fs.existsSync(opts.dataPath) && !opts.dataPath.startsWith(':')) {
			createDirIfNotExists(opts.dataPath);
		}

		this.dbInstance = new Database(opts.dataPath);
		this.dbInstance.pragma('journal_mode = WAL');

		this.dbClient = drizzle(this.dbInstance);

		this.checkDatabase(opts.dataPath);
	}

	private checkDatabase(filePath: string) {
		if (!tableExists(getTableName(streamDataTable), this.dbClient)) {
			this.initializeDatabase();
		}
	}

	private initializeDatabase() {
		this.dbClient.run(createTableStatement);
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
			.orderBy(streamDataTable.ts, streamDataTable.sequence_no)
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
			.orderBy(desc(streamDataTable.ts))
			.limit(requestCount)
			.prepare();

		const results$ = from(preparedQuery.execute()).pipe(
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

	public store(streamMessage: StreamMessage): Promise<boolean> {
		this.dbClient
			.insert(streamDataTable)
			.values({
				stream_id: streamMessage.getStreamId(),
				partition: streamMessage.getStreamPartition(),
				ts: streamMessage.getTimestamp(),
				sequence_no: streamMessage.getSequenceNumber(),
				publisher_id: streamMessage.getPublisherId(),
				msg_chain_id: streamMessage.getMsgChainId(),
				payload: JSON.parse(streamMessage.serialize()),
				content_bytes: Buffer.byteLength(streamMessage.serialize()),
			})
			.prepare()
			.run();

		this.emit('write', streamMessage);

		return Promise.resolve(true);
	}

	getTotalBytesInStream(streamId: string, partition: number): Promise<number> {
		throw new Error('Method not implemented.');
	}

	getLastMessageDateInStream(
		streamId: string,
		partition: number
	): Promise<number | null> {
		throw new Error('Method not implemented.');
	}

	getFirstMessageDateInStream(
		streamId: string,
		partition: number
	): Promise<number | null> {
		throw new Error('Method not implemented.');
	}

	getNumberOfMessagesInStream(
		streamId: string,
		partition: number
	): Promise<number> {
		throw new Error('Method not implemented.');
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
