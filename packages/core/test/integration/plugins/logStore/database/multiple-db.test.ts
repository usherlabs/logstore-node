import { MessageID, StreamMessage, toStreamID } from '@streamr/protocol';
import { waitForStreamToEnd } from '@streamr/test-utils';
import { toEthereumAddress } from '@streamr/utils';
import { shuffle } from 'lodash';
import { Readable } from 'stream';

import { CassandraDBAdapter } from '../../../../../src/plugins/logStore/database/CassandraDBAdapter';
import { DatabaseAdapter } from '../../../../../src/plugins/logStore/database/DatabaseAdapter';
import { SQLiteDBAdapter } from '../../../../../src/plugins/logStore/database/SQLiteDBAdapter';
import { STREAMR_DOCKER_DEV_HOST } from '../../../../utils';

const MOCK_MSG_CHAIN_ID = 'msgChainId';
const MOCK_STREAM_ID = 'streamId';
const MOCK_PUBLISHER_ID = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

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
		content: JSON.stringify({
			timestamp,
			sequence_no,
		}),
		signature: 'signature',
	});

describe('Multiple DB', () => {
	describe('methods test', () => {
		let dbs: DatabaseAdapter[];

		beforeEach(() => {
			const sqliteDb = new SQLiteDBAdapter({
				type: 'sqlite',
				dataPath: ':memory:',
				// if you wish to debug, uncomment to change it
				// to file mode, instead of memory
				// dataPath: dbPath,
			});

			const cassandraDb = new CassandraDBAdapter(
				{
					type: 'cassandra',
					contactPoints: [STREAMR_DOCKER_DEV_HOST],
					localDataCenter: 'datacenter1',
					keyspace: 'logstore_dev',
				},
				{
					checkFullBucketsTimeout: 100,
					storeBucketsTimeout: 100,
					bucketKeepAliveSeconds: 5,
				}
			);

			dbs = [sqliteDb, cassandraDb];
		});

		afterEach(async () => {
			for (const db of dbs) {
				await db.stop();
			}
		});

		test('conformity test', async () => {
			const msgs = [
				getMockMessage(MOCK_STREAM_ID, 1, 0),
				getMockMessage(MOCK_STREAM_ID, 1, 1),
				getMockMessage(MOCK_STREAM_ID, 2, 0),
				getMockMessage(MOCK_STREAM_ID, 3, 0),
				getMockMessage(MOCK_STREAM_ID, 3, 1),
			];
			const shuffledMsgs = shuffle(msgs);

			const dbResults = [];
			for (const db of dbs) {
				const MOCK_STREAM_ID = msgs[0].getStreamId();
				const MOCK_PUBLISHER_ID = msgs[0].getPublisherId();
				const MOCK_MSG_CHAIN_ID = msgs[0].getMsgChainId();

				await Promise.all(shuffledMsgs.map((m) => db.store(m)));

				const byIdMsgs = shuffledMsgs.slice(0, 3);
				const byMessageIdStream = db.queryByMessageIds(
					byIdMsgs.map((msg) => msg.messageId)
				);
				const requestLastStream = db.queryLast(MOCK_STREAM_ID, 0, 3);
				const requestRangeStream = db.queryRange(
					MOCK_STREAM_ID,
					0,
					1,
					0,
					3,
					0,
					MOCK_PUBLISHER_ID,
					MOCK_MSG_CHAIN_ID
				);

				const byMsgResults = await expectDatabaseOutputConformity(
					byMessageIdStream,
					byIdMsgs
				);
				const lastMsgResults = await expectDatabaseOutputConformity(
					requestLastStream,
					msgs.slice(2)
				);
				const rangeResults = await expectDatabaseOutputConformity(
					requestRangeStream,
					msgs.slice(0, 4)
				);

				dbResults.push({
					byMsgResults,
					lastMsgResults,
					rangeResults,
				});
			}

			for (const dbResult of dbResults.slice(1)) {
				expect(dbResult).toEqual(dbResults[0]);
			}
		});
	});
});

const expectDatabaseOutputConformity = async (
	output: Readable,
	expectedMessages: StreamMessage[]
) => {
	const messages = (await waitForStreamToEnd(output)) as StreamMessage[];
	// format test
	const expectedMessage = expectedMessages[0];
	const message = messages[0];
	expect(message).toBeInstanceOf(StreamMessage);
	expect(message.getStreamId()).toEqual(expectedMessage.getStreamId());
	expect(message.getContent()).toEqual(expectedMessage.getContent());

	expect(messages.map((m) => m.getContent())).toEqual(
		expectedMessages.map((m) => m.getContent())
	);
	return messages;
};
