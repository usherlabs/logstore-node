import { MessageID, StreamMessage, toStreamID } from '@streamr/protocol';
import { toEthereumAddress } from '@streamr/utils';
import { globSync } from 'eslint-import-resolver-typescript';
import fs from 'fs';
import path from 'path';
import { firstValueFrom, from, toArray } from 'rxjs';

import { SQLiteDBAdapter } from '../../../../../src/plugins/logStore/database/SQLiteDBAdapter';
import { MAX_SEQUENCE_NUMBER_VALUE } from '../../../../../src/plugins/logStore/LogStore';


const getMockMessage = (streamId: string, timestamp: number) =>
	new StreamMessage({
		messageId: new MessageID(
			toStreamID(streamId),
			0,
			timestamp,
			0,
			toEthereumAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
			''
		),
		content: JSON.stringify({}),
		signature: 'signature',
	});

describe('SQLite', () => {
	const dbPath = path.join(process.cwd(), '.data/test.db');

	afterEach(() => {
		// unlink files if exists - -wal and -shm
		const files = globSync(dbPath + '*');
		files.forEach((file) => {
			fs.unlinkSync(file);
		});
	});

	test('it creates and uses the file without problems', async () => {
		const testDb = new SQLiteDBAdapter({ type: 'sqlite', dataPath: dbPath });
		await testDb.store(getMockMessage('streamId', 1));
	});

	describe('methods test', () => {
		let db: SQLiteDBAdapter;
		// project root / test.db

		beforeEach(() => {
			db = new SQLiteDBAdapter({
				type: 'sqlite',
				// dataPath: ':memory:'
				// if you wish to debug, uncomment to change it
				// to file mode, instead of memory
				dataPath: dbPath,
			});
		});

		afterEach(async () => {
			await db.stop();
		});

		test('queryLast works', async () => {
			const streamId = 'streamId';
			const partition = 0;
			const requestCount = 2;
			const messages = [
				getMockMessage(streamId, 1),
				getMockMessage(streamId, 2),
				getMockMessage(streamId, 3),
			];

			await db.store(messages[0]);
			await db.store(messages[1]);
			await db.store(messages[2]);

			const stream = db.queryLast(streamId, partition, requestCount);
			const result = await firstValueFrom(from(stream).pipe(toArray()));

			expect(result).toEqual(
				messages
					.slice(1)
					.reverse()
					.map((s) => JSON.parse(s.serialize()))
			);
		});

		test('queryRange works', async () => {
			const streamId = 'streamId';
			const partition = 0;
			const messages = [
				getMockMessage(streamId, 1),
				getMockMessage(streamId, 2),
				getMockMessage(streamId, 3),
				getMockMessage(streamId, 4),
			];

			for (const message of messages) {
				await db.store(message);
			}

			const stream = db.queryRange(
				streamId,
				partition,
				2,
				0,
				3,
				MAX_SEQUENCE_NUMBER_VALUE
			);
			const result = await firstValueFrom(from(stream).pipe(toArray()));

			expect(result).toEqual(
				messages.slice(1, 3).map((s) => JSON.parse(s.serialize()))
			);
		});

		test('query by message id works', async () => {
			const streamId = 'streamId';
			const messages = [
				getMockMessage(streamId, 1),
				getMockMessage(streamId, 2),
				getMockMessage(streamId, 3),
				getMockMessage(streamId, 4),
			];

			for (const message of messages) {
				await db.store(message);
			}

			const stream = db.queryByMessageIds([
				messages[1].messageId,
				messages[2].messageId,
			]);

			const result = await firstValueFrom(from(stream).pipe(toArray()));

			expect(result).toEqual(
				messages.slice(1, 3).map((s) => JSON.parse(s.serialize()))
			);
		});
	});
});
