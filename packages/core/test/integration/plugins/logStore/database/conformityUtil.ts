import {StreamMessage} from '@streamr/protocol';
import {waitForStreamToEnd} from '@streamr/test-utils';
import {Readable} from 'stream';


export const expectDatabaseOutputConformity = async (
	output: Readable,
	expectedMessage: StreamMessage
) => {
	const messages = (await waitForStreamToEnd(output)) as StreamMessage[];
	// conformity test should have one message
	expect(messages).toHaveLength(1);
	const message = messages[0];
	expect(message).toBeInstanceOf(StreamMessage);
	expect(message.getStreamId()).toEqual(expectedMessage.getStreamId());
	expect(message.getContent()).toEqual(expectedMessage.getContent());
};
