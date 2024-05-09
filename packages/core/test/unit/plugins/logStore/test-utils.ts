import { QueryPropagate, QueryResponse } from '@logsn/protocol';
import {
	ContentType,
	EncryptionType,
	MessageID,
	SignatureType,
	StreamMessage,
	toStreamID,
} from '@streamr/protocol';
import { convertBytesToStreamMessage } from '@streamr/trackerless-network';
import {
	EthereumAddress,
	hexToBinary,
	toEthereumAddress,
	utf8ToBinary,
} from '@streamr/utils';

import { DatabaseAdapter } from '../../../../src/plugins/logStore/database/DatabaseAdapter';

export const PUBLISHER_ID = '0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a';
export const STREAM_ID = `${PUBLISHER_ID}/pulse`;
export const STREAM_PARTITION = 0;
export const MSG_CHAIN_ID = 'msgChainId';
export const REQUEST_ID = 'request-001';

export function createQueryResponse(
	requestId: string,
	serializedMessages: Uint8Array[],
	isFinal: boolean
) {
	const messageRefs = serializedMessages.map((serializedMessage) =>
		convertBytesToStreamMessage(serializedMessage).messageId.toMessageRef()
	);

	// return new QueryResponse({requestId, });
	return new QueryResponse({
		requestId,
		requestPublisherId: PUBLISHER_ID,
		messageRefs,
		isFinal,
	});
}

export function createQueryPropagate(
	requestId: string,
	serializedMessages: Uint8Array[]
) {
	return new QueryPropagate({
		requestId,
		requestPublisherId: PUBLISHER_ID,
		payload: serializedMessages,
	});
}

export function mockStreamMessage({
	streamId = STREAM_ID,
	streamPartition = STREAM_PARTITION,
	timestamp,
	sequenceNumber = 0,
	publisherId = toEthereumAddress(PUBLISHER_ID),
	msgChainId = MSG_CHAIN_ID,
}: {
	streamId?: string;
	streamPartition?: number;
	timestamp: number;
	sequenceNumber?: number;
	publisherId?: EthereumAddress;
	msgChainId?: string;
}) {
	return new StreamMessage({
		messageId: new MessageID(
			toStreamID(streamId),
			streamPartition,
			timestamp,
			sequenceNumber,
			publisherId,
			msgChainId
		),
		content: Buffer.from(utf8ToBinary(JSON.stringify({ ts: timestamp }))),
		signature: Buffer.from(hexToBinary('0x1234')),
		contentType: ContentType.JSON,
		encryptionType: EncryptionType.NONE,
		signatureType: SignatureType.SECP256K1,
	});
}

export function* mockStreamMessageRange(from: number, to: number) {
	for (let timestamp = from; timestamp <= to; timestamp++) {
		yield mockStreamMessage({ timestamp });
	}
}

export function fillStorageWithRange(
	database: DatabaseAdapter,
	from: number,
	to: number
) {
	for (const streamMessage of mockStreamMessageRange(from, to)) {
		database.store(streamMessage);
	}
}
