import { StreamMessage } from '@streamr/protocol';
import { convertBytesToStreamMessage } from '@streamr/trackerless-network';
import { binaryToHex, toLengthPrefixedFrame } from '@streamr/utils';

export interface Format {
	formatMessage:
		| ((bytes: Uint8Array) => string)
		| ((bytes: Uint8Array) => Uint8Array);
	contentType: string;
	delimiter?: string;
	header?: string;
	footer?:
		| ((metadata: Record<string, any>, isStreamed?: boolean) => string[])
		| string;
}

const createJsonFormat = (
	formatMessage: (bytes: Uint8Array) => string
): Format => {
	return {
		formatMessage,
		contentType: 'application/json',
		delimiter: ',',
		header: '{"messages":[',
		footer: (metadata, isStreamed) => {
			const metadataString = JSON.stringify({
				...metadata,
				type: 'metadata',
			});
			return [isStreamed ? metadataString : `],"metadata":${metadataString}}`];
		},
	};
};

const createBinaryFormat = (
	formatMessage: (bytes: Uint8Array) => Uint8Array
): Format => {
	return {
		formatMessage,
		contentType: 'application/octet-stream',
	};
};

export const toObject = (msg: StreamMessage): any => {
	const parsedContent = msg.getParsedContent();
	const result: any = {
		streamId: msg.getStreamId(),
		streamPartition: msg.getStreamPartition(),
		timestamp: msg.getTimestamp(),
		sequenceNumber: msg.getSequenceNumber(),
		publisherId: msg.getPublisherId(),
		msgChainId: msg.getMsgChainId(),
		messageType: msg.messageType,
		contentType: msg.contentType,
		encryptionType: msg.encryptionType,
		content:
			parsedContent instanceof Uint8Array
				? binaryToHex(parsedContent)
				: parsedContent,
		signatureType: msg.signatureType,
		signature: binaryToHex(msg.signature),
	};
	if (msg.groupKeyId !== undefined) {
		result.groupKeyId = msg.groupKeyId;
	}
	return result;
};

const FORMATS: Record<string, Format> = {
	object: createJsonFormat((bytes: Uint8Array) =>
		JSON.stringify(toObject(convertBytesToStreamMessage(bytes)))
	),
	raw: createBinaryFormat(toLengthPrefixedFrame),
};

export const getFormat = (id: string | undefined): Format | undefined => {
	const key = id ?? 'object';
	return FORMATS[key];
};
