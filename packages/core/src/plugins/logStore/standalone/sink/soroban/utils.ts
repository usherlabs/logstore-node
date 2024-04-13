import { nativeToScVal, xdr } from '@stellar/stellar-sdk';

import { MessagePayload } from './types';

export function hexStringToBytes(hexString: string) {
	// Check if the hex string starts with '0x' and remove it
	if (hexString.startsWith('0x')) {
		hexString = hexString.slice(2);
	}

	// Initialize an array to hold the byte values
	const bytes: number[] = [];

	// Loop through the hex string, two characters at a time
	for (let i = 0; i < hexString.length; i += 2) {
		// Convert the current pair of hex characters to a byte
		const byte = parseInt(hexString.substring(i, i + 2), 16);
		// Add the byte to the array
		bytes.push(byte);
	}

	return bytes;
}

const getNoneVariant = () =>
	nativeToScVal([nativeToScVal('None', { type: 'symbol' })]);

const getSomeVariant = (value: xdr.ScVal) =>
	nativeToScVal([nativeToScVal('Some', { type: 'symbol' }), value]);

// takes in a message for streamr and return the scval type
// which is the equivalent type on the soroban blockchain
// Structs with named fields are stored on the ledger as a map of key-value pairs,
// where the key is symbol type (https://developers.stellar.org/docs/learn/smart-contract-internals/types/custom-types#structs-with-named-fields),
// so you need to specify that when passing an object to nativeToScVal.
// Also, you must order the keys in the object alphabetically (https://github.com/stellar/stellar-protocol/blob/master/core/cap-0046-01.md#comparison).
export function transformPayload(payload: MessagePayload) {
	const { messageId: rawMessage } = payload;
	// define the parameters to be sent to the contract
	const messageId = nativeToScVal(
		{
			msg_chain_id: nativeToScVal(rawMessage.msgChainId, { type: 'string' }),
			publisher_id: nativeToScVal(
				new Uint8Array(hexStringToBytes(rawMessage.publisherId))
			),
			sequence_number: nativeToScVal(rawMessage.sequenceNumber),
			stream_id: nativeToScVal(rawMessage.streamId, { type: 'string' }),
			stream_partition: nativeToScVal(rawMessage.streamPartition),
			timestamp: nativeToScVal(rawMessage.timestamp),
		},
		{
			type: {
				msg_chain_id: ['symbol', null],
				publisher_id: ['symbol', null],
				sequence_number: ['symbol', null],
				stream_id: ['symbol', null],
				stream_partition: ['symbol', null],
				timestamp: ['symbol', null],
			},
		}
	);

	const message = nativeToScVal(
		{
			content_type: nativeToScVal(payload.contentType),
			encryption_type: nativeToScVal(payload.encryptionType),
			group_key_id: payload.groupKeyId
				? getSomeVariant(nativeToScVal(payload.groupKeyId, { type: 'string' }))
				: getNoneVariant(),
			message_id: messageId,
			message_type: nativeToScVal(payload.messageType),
			new_group_key: payload.newGroupKey
				? getSomeVariant(nativeToScVal('Some', { type: 'symbol' }))
				: getNoneVariant(),
			prev_msg_ref: payload.prevMsgRef
				? getSomeVariant(
						nativeToScVal(
							{
								sequence_number: nativeToScVal(
									payload.prevMsgRef.sequenceNumber
								),
								timestamp: nativeToScVal(payload.prevMsgRef.timestamp),
							},
							{
								type: {
									sequence_number: ['symbol', null],
									timestamp: ['symbol', null],
								},
							}
						)
				  )
				: getNoneVariant(),
			serialized_content: nativeToScVal(payload.serializedContent, {
				type: 'string',
			}),
			signature: nativeToScVal(
				new Uint8Array(hexStringToBytes(payload.signature))
			),
		},
		{
			type: {
				content_type: ['symbol', null],
				encryption_type: ['symbol', null],
				group_key_id: ['symbol', null],
				message_id: ['symbol', null],
				message_type: ['symbol', null],
				new_group_key: ['symbol', null],
				prev_msg_ref: ['symbol', null],
				serialized_content: ['symbol', null],
				signature: ['symbol', null],
			},
		}
	);

	return message;
}
