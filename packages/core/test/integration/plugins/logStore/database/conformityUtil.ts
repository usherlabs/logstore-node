import { StreamMessage } from '@streamr/protocol';
import { waitForStreamToEnd } from '@streamr/test-utils';
import { shuffle } from 'lodash';
import { Readable } from 'stream';

import { DatabaseAdapter } from '../../../../../src/plugins/logStore/database/DatabaseAdapter';

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
};

export const testConformity = async (
	db: DatabaseAdapter,
	msgs: StreamMessage[]
) => {
	const MOCK_STREAM_ID = msgs[0].getStreamId();
	const MOCK_PUBLISHER_ID = msgs[0].getPublisherId();
	const MOCK_MSG_CHAIN_ID = msgs[0].getMsgChainId();

	const shuffledMsgs = shuffle(msgs);
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

	await expectDatabaseOutputConformity(byMessageIdStream, byIdMsgs);
	await expectDatabaseOutputConformity(requestLastStream, msgs.slice(2));
	await expectDatabaseOutputConformity(requestRangeStream, msgs.slice(0, 4));
};
