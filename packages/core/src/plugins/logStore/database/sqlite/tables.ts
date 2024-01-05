import { and, eq, sql } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { int, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';


export const streamDataTable = sqliteTable(
	'stream_data',
	{
		stream_id: text('stream_id').notNull(),
		partition: int('partition').notNull(),
		ts: int('ts').notNull(),
		sequence_no: int('sequence_no').notNull(),
		publisher_id: text('publisher_id').notNull(),
		msg_chain_id: text('msg_chain_id').notNull(),
		content_bytes: int('content_bytes').notNull(),
		payload: text('payload', { mode: 'json' }).notNull(),
		decrypted_content: text('decrypted_content', { mode: 'json' }),
	},
	(table) => ({
		messageID: primaryKey({
			columns: [
				table.stream_id,
				table.partition,
				table.ts,
				table.sequence_no,
				table.publisher_id,
				table.msg_chain_id,
			],
			name: 'messageID',
		}),
	})
);

export const createTableStatement = sql`
	CREATE TABLE IF NOT EXISTS stream_data
	(
		stream_id         TEXT    NOT NULL,
		partition         INTEGER NOT NULL,
		ts                INTEGER NOT NULL,
		sequence_no       INTEGER NOT NULL,
		publisher_id      TEXT    NOT NULL,
		msg_chain_id      TEXT    NOT NULL,
		content_bytes     INTEGER NOT NULL,
		payload           TEXT    NOT NULL,
		decrypted_content TEXT,
		PRIMARY KEY (
								 stream_id, partition, ts, sequence_no,
								 publisher_id, msg_chain_id
			)
	) WITHOUT ROWID;
`;

// this is a utility definition and is used so we can determine table names
const sqliteMasterTable = sqliteTable(
	'sqlite_master',
	{
		type: text('type'),
		name: text('name'),
		tbl_name: text('tbl_name'),
		rootpage: int('rootpage'),
		sql: text('sql'),
	},
	(table) => ({
		name: primaryKey({
			columns: [table.name],
			name: 'name',
		}),
	})
);

export const tableExists = (tableName: string, db: BetterSQLite3Database) => {
	return db
		.select({
			name: sqliteMasterTable.name,
		})
		.from(sqliteMasterTable)
		.where(
			and(
				eq(sqliteMasterTable.type, 'table'),
				eq(sqliteMasterTable.name, tableName)
			)
		)
		.prepare()
		.get()
		? true
		: false;
};
