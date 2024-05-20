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
import { hexToBinary, toEthereumAddress, utf8ToBinary } from '@streamr/utils';
import { globSync } from 'fast-glob';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

import { SQLiteDBAdapter } from '../../../../../src/plugins/logStore/database/SQLiteDBAdapter';
import { MAX_SEQUENCE_NUMBER_VALUE } from '../../../../../src/plugins/logStore/LogStore';

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
) =>
	new StreamMessage({
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
		await testDb.store(createMockMessage(1));
	});

	describe('methods test', () => {
		let db: SQLiteDBAdapter;

		beforeEach(() => {
			db = new SQLiteDBAdapter({
				type: 'sqlite',
				dataPath: ':memory:',
				// if you wish to debug, uncomment to change it
				// to file mode, instead of memory
				// dataPath: dbPath,
			});
		});

		afterEach(async () => {
			await db.stop();
		});

		test('queryLast works', async () => {
			const partition = 0;
			const requestCount = 2;
			const messages = [
				createMockMessage(1),
				createMockMessage(2),
				createMockMessage(3),
			];

			await db.store(messages[0]);
			await db.store(messages[1]);
			await db.store(messages[2]);

			const stream = db.queryLast(MOCK_STREAM_ID, partition, requestCount);
			const contentValues = await streamToContentValues(stream);
			expect(contentValues).toEqual([2, 0, 3, 0]);
		});

		test('queryFirst works', async () => {
			const streamId = MOCK_STREAM_ID;
			const partition = 0;
			const requestCount = 2;
			const messages = [
				createMockMessage(1),
				createMockMessage(2),
				createMockMessage(3),
			];

			await db.store(messages[0]);
			await db.store(messages[1]);
			await db.store(messages[2]);

			const stream = db.queryFirst(streamId, partition, requestCount);
			const contentValues = await streamToContentValues(stream);

			expect(contentValues).toEqual([1, 0, 2, 0]);
		});

		test('queryRange works', async () => {
			const partition = 0;
			const messages = [
				createMockMessage(1),
				createMockMessage(2),
				createMockMessage(3),
				createMockMessage(4),
			];

			for (const message of messages) {
				await db.store(message);
			}

			const stream = db.queryRange(
				MOCK_STREAM_ID,
				partition,
				2,
				0,
				3,
				MAX_SEQUENCE_NUMBER_VALUE
			);
			const contentValues = await streamToContentValues(stream);
			expect(contentValues).toEqual([2, 0, 3, 0]);
		});

		test('query range works in multiple edge cases with sequence numbers', async () => {
			const partition = 0;
			const messages = [
				createMockMessage(1, 0), // 0
				createMockMessage(1, 1), // 1
				createMockMessage(1, 2), // 2
				createMockMessage(2, 0), // 3
				createMockMessage(3, 0), // 4
				createMockMessage(3, 1), // 5
				createMockMessage(4, 0), // 6
				createMockMessage(4, 1), // 7
				createMockMessage(4, 2), // 8
				createMockMessage(4, 3), // 9
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
				[1, 1, 1, 2, 2, 0, 3, 0, 3, 1, 4, 0, 4, 1, 4, 2],
				[1, 0, 1, 1, 1, 2, 2, 0, 3, 0, 3, 1, 4, 0],
				[1, 1, 1, 2, 2, 0, 3, 0, 3, 1, 4, 0, 4, 1],
				[4, 1, 4, 2],
			];

			for (const c of cases) {
				const i = cases.indexOf(c);
				const [fromTimestamp, fromSequenceNo, toTimestamp, toSequenceNo] = c;

				const stream = db.queryRange(
					MOCK_STREAM_ID,
					partition,
					fromTimestamp,
					fromSequenceNo,
					toTimestamp,
					toSequenceNo
				);
				const contentValues = await streamToContentValues(stream);
				expect(contentValues).toEqual(returnSlices[i]);
			}
		});

		test('query by message id works', async () => {
			const messages = [
				createMockMessage(1),
				createMockMessage(2),
				createMockMessage(3),
				createMockMessage(4),
			];

			for (const message of messages) {
				await db.store(message);
			}

			const queriedMessages = [messages[1], messages[3], messages[2]];
			const stream = db.queryByMessageRefs(
				MOCK_STREAM_ID,
				MOCK_PARTITION,
				queriedMessages.map((m) => m.getMessageRef())
			);

			const contentValues = await streamToContentValues(stream);
			expect(contentValues).toEqual([2, 0, 4, 0, 3, 0]);
		});

		test('details', async () => {
			const messages = [
				createMockMessage(1),
				createMockMessage(2),
				createMockMessage(3),
				createMockMessage(4),
			];

			for (const message of messages) {
				await db.store(message);
			}

			const firstMessageDate = await db.getFirstMessageDateInStream(
				MOCK_STREAM_ID,
				0
			);
			const numberOfMessages = await db.getNumberOfMessagesInStream(
				MOCK_STREAM_ID,
				0
			);
			const lastMessageDate = await db.getLastMessageDateInStream(
				MOCK_STREAM_ID,
				0
			);
			const totalBytes = await db.getTotalBytesInStream(MOCK_STREAM_ID, 0);

			expect(firstMessageDate).toBe(1);
			expect(numberOfMessages).toBe(4);
			expect(lastMessageDate).toBe(4);
			expect(totalBytes).toBe(436);
		});
	});
});
