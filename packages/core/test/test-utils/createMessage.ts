import { sign } from '@logsn/client';
import {
	createSignaturePayload,
	MessageID,
	StreamMessage,
	toStreamID,
} from '@streamr/protocol';
import { fastWallet } from '@streamr/test-utils';
import { toEthereumAddress } from '@streamr/utils';
import { Wallet } from 'ethers';

type Options = {
	streamId?: string;
	streamPartition?: number;
	timestamp?: number;
	sequenceNumber?: number;
	msgChainId?: string;
	content?: any;
	publisherWallet?: Wallet;
};

export function createMessage({
	streamId = 'test-stream',
	streamPartition = 0,
	timestamp = Date.now(),
	sequenceNumber = 0,
	msgChainId = '1',
	content = { foo: 'bar' },
	publisherWallet = fastWallet(),
}: Options = {}) {
	const messageID = new MessageID(
		toStreamID(streamId),
		streamPartition,
		timestamp,
		sequenceNumber,
		toEthereumAddress(publisherWallet.address),
		msgChainId
	);
	const serializedContent = JSON.stringify(content);
	const payload = createSignaturePayload({
		messageId: messageID,
		serializedContent,
	});
	const signature = sign(payload, publisherWallet.privateKey);

	return new StreamMessage({
		messageId: messageID,
		content: serializedContent,
		signature: signature,
	});
}
