import { MessageID, StreamMessage } from '@streamr/protocol';
import Database from 'better-sqlite3';
import { and, between, desc, eq, placeholder } from 'drizzle-orm';
import { BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { getTableName } from 'drizzle-orm/table';
import fs from 'fs';
import { Readable } from 'stream';

import { DatabaseAdapter } from './DatabaseAdapter';
import {
	createTableStatement,
	streamDataTable,
	tableExists,
} from './sqlite/tables';
import {isPresent} from "../../../helpers/isPresent";


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
		let query = this.dbClient
			.select({
				payload: streamDataTable.payload,
			})
			.from(streamDataTable)
			.where(
				and(
					eq(streamDataTable.stream_id, streamId),
					eq(streamDataTable.partition, partition),
					between(streamDataTable.ts, fromTimestamp, toTimestamp),
					between(streamDataTable.sequence_no, fromSequenceNo, toSequenceNo),
					publisherId
						? eq(streamDataTable.publisher_id, publisherId)
						: undefined,
					msgChainId ? eq(streamDataTable.msg_chain_id, msgChainId) : undefined
				)
			)
			.$dynamic();

		if (limit) {
			query = query.limit(limit);
		}

		const preparedQuery = query.prepare();

		return Readable.from(preparedQuery.all().map((c) => c.payload));
	}

	public queryLast(
		streamId: string,
		partition: number,
		requestCount: number
	): Readable {
		const query = this.dbClient
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
			.limit(requestCount);

		const preparedQuery = query.prepare();

		return Readable.from(preparedQuery.all().map((c) => c.payload));
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

		const queries = messageIds
			.map((messageId) =>
				queryTemplate.get({
					stream_id: messageId.streamId,
					partition: messageId.streamPartition,
					ts: messageId.timestamp,
					sequence_no: messageId.sequenceNumber,
					publisher_id: messageId.publisherId,
					msg_chain_id: messageId.msgChainId,
				})
			)
			.filter(isPresent);

		return Readable.from(queries.map((c) => c.payload));
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
