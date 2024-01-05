import { MessageID, StreamMessage, toStreamID } from '@streamr/protocol';
import { toEthereumAddress } from '@streamr/utils';
import { globSync } from 'eslint-import-resolver-typescript';
import fs from 'fs';
import path from 'path';
import { firstValueFrom, from, map, toArray } from 'rxjs';
import { Readable } from 'stream';

import { SQLiteDBAdapter } from '../../../../../src/plugins/logStore/database/SQLiteDBAdapter';
import { MAX_SEQUENCE_NUMBER_VALUE } from '../../../../../src/plugins/logStore/LogStore';
import { expectDatabaseOutputConformity } from './conformityUtil';


const MOCK_STREAM_ID = 'streamId';
const MOCK_PUBLISHER_ID = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const MOCK_MSG_CHAIN_ID = 'msgChainId';
const getMockMessage = (streamId: string, timestamp: number, sequence_no = 0) =>
	new StreamMessage({
		messageId: new MessageID(
			toStreamID(streamId),
			0,
			timestamp,
			sequence_no,
			toEthereumAddress(MOCK_PUBLISHER_ID),
			MOCK_MSG_CHAIN_ID
		),
		content: JSON.stringify({}),
		signature: 'signature',
	});

function streamToSerializedMsg(stream: Readable) {
	return firstValueFrom(
		from(stream).pipe(
			map((s: StreamMessage) => s.serialize()),
			toArray()
		)
	);
}

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
		await testDb.store(getMockMessage(MOCK_STREAM_ID, 1));
	});

	describe('methods test', () => {
		let db: SQLiteDBAdapter;

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
			const streamId = MOCK_STREAM_ID;
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
			const result = await streamToSerializedMsg(stream);

			expect(result).toEqual(
				messages
					.slice(1)
					.reverse()
					.map((s) => s.serialize())
			);
		});

		test('queryRange works', async () => {
			const streamId = MOCK_STREAM_ID;
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
			const result = await streamToSerializedMsg(stream);

			expect(result).toEqual(messages.slice(1, 3).map((s) => s.serialize()));
		});

		test('query range works in multiple edge cases with sequence numbers', async () => {
			const partition = 0;
			const messages = [
				getMockMessage(MOCK_STREAM_ID, 1, 0), // 0
				getMockMessage(MOCK_STREAM_ID, 1, 1), // 1
				getMockMessage(MOCK_STREAM_ID, 1, 2), // 2
				getMockMessage(MOCK_STREAM_ID, 2, 0), // 3
				getMockMessage(MOCK_STREAM_ID, 3, 0), // 4
				getMockMessage(MOCK_STREAM_ID, 3, 1), // 5
				getMockMessage(MOCK_STREAM_ID, 4, 0), // 6
				getMockMessage(MOCK_STREAM_ID, 4, 1), // 7
				getMockMessage(MOCK_STREAM_ID, 4, 2), // 8
				getMockMessage(MOCK_STREAM_ID, 4, 3), // 9
			];

			for (const message of messages) {
				await db.store(message);
			}

			// plan:
			// - query from 1, 1 to 4, 2 - normal - returns from 1 to 8
			// - query from 1, 0 to 4, 0 - normal - returns from 0 to 6
			// - query from 1, 1 to 4, 1 - test sequence no - returns from 1 to 7
			// - query from 4, 1 to 4, 2 - intra timestamp - returns from 7 to 8
			const cases = [
				[1, 1, 4, 2],
				[1, 0, 4, 0],
				[1, 1, 4, 1],
				[4, 1, 4, 2],
			];

			const returnSlices = [
				[1, 9],
				[0, 7],
				[1, 8],
				[7, 9],
			];

			for (const c of cases) {
				const i = cases.indexOf(c);
				const [fromTimestamp, fromSequenceNo, toTimestamp, toSequenceNo] = c;
				const [fromSlice, toSlice] = returnSlices[i];

				const stream = db.queryRange(
					MOCK_STREAM_ID,
					partition,
					fromTimestamp,
					fromSequenceNo,
					toTimestamp,
					toSequenceNo
				);
				const result = await streamToSerializedMsg(stream);

				expect(result).toEqual(
					messages.slice(fromSlice, toSlice).map((s) => s.serialize())
				);
			}
		});

		test('query by message id works', async () => {
			const streamId = MOCK_STREAM_ID;
			const messages = [
				getMockMessage(streamId, 1),
				getMockMessage(streamId, 2),
				getMockMessage(streamId, 3),
				getMockMessage(streamId, 4),
			];

			for (const message of messages) {
				await db.store(message);
			}

			const queriedMessages = [messages[1], messages[3], messages[2]];
			const stream = db.queryByMessageIds(
				queriedMessages.map((m) => m.messageId)
			);

			const result = await streamToSerializedMsg(stream);

			// important to see if it's on the same order
			expect(result).toEqual(queriedMessages.map((s) => s.serialize()));
		});

		test('conformity test', async () => {
			const msg1 = getMockMessage(MOCK_STREAM_ID, 1);

			await db.store(msg1);

			const byMessageIdStream = db.queryByMessageIds([msg1.messageId]);
			const requestLastStream = db.queryLast(MOCK_STREAM_ID, 0, 1);
			const requestRangeStream = db.queryRange(
				MOCK_STREAM_ID,
				0,
				1,
				0,
				1,
				0,
				MOCK_PUBLISHER_ID,
				MOCK_MSG_CHAIN_ID
			);

			await expectDatabaseOutputConformity(byMessageIdStream, msg1);
			await expectDatabaseOutputConformity(requestLastStream, msg1);
			await expectDatabaseOutputConformity(requestRangeStream, msg1);
		});
	});
});
