import { QueryPropagate, QueryResponse } from '@logsn/protocol';
import { createSignaturePayload, StreamMessage } from '@streamr/protocol';
import { EthereumAddress, toEthereumAddress } from '@streamr/utils';
import { ScalableBloomFilter } from 'bloom-filters';
import { keccak256 } from 'ethers/lib/utils';

import { QueryResolutionState } from '../../../../src/plugins/logStore/network/QueryResolutionState';
import { createMessage } from '../../../test-utils';

const foreignNode1: EthereumAddress = toEthereumAddress(
	'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);
const foreignNode2: EthereumAddress = toEthereumAddress(
	'0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
);

let timestamp = 100200300;
const messageA = createMessage({ timestamp: ++timestamp });
const messageB = createMessage({ timestamp: ++timestamp });
const messageC = createMessage({ timestamp: ++timestamp });

const requestId = 'aaa-bbb-ccc';
const requestPublisherId = '0xffffffffffffffffffffffffffffffffffffffff';

function buildHashMap(messages: StreamMessage[]) {
	return new Map<string, string>(
		messages.map((m) => {
			const payload = createSignaturePayload({
				messageId: m.getMessageID(),
				serializedContent: m.getSerializedContent(),
				prevMsgRef: m.prevMsgRef ?? undefined,
				newGroupKey: m.newGroupKey ?? undefined,
			});
			const messageHash = keccak256(Uint8Array.from(Buffer.from(payload)));
			return [m.messageId.serialize(), messageHash];
		})
	);
}

function buildQueryResponse(messages: StreamMessage[]) {
	let hash = keccak256([]);
	const bloomFilter = new ScalableBloomFilter();
	messages.forEach((m) => {
		const payload = createSignaturePayload({
			messageId: m.getMessageID(),
			serializedContent: m.getSerializedContent(),
			prevMsgRef: m.prevMsgRef ?? undefined,
			newGroupKey: m.newGroupKey ?? undefined,
		});
		const messageHash = keccak256(Uint8Array.from(Buffer.from(payload)));
		hash = keccak256(Uint8Array.from(Buffer.from(hash + messageHash)));
		bloomFilter.add(messageHash);
	});

	const queryResponse = new QueryResponse({
		requestId,
		requestPublisherId,
		hash,
		bloomFilter: JSON.stringify(bloomFilter.saveAsJSON()),
		// hashMap: new Map(),
	});

	return queryResponse;
}

function buildQueryPropagation(messages: StreamMessage[]) {
	const payload: [string, string][] = [];

	messages.forEach((m) => {
		payload.push([m.messageId.serialize(), m.serialize()]);
	});

	const queryResponse = new QueryPropagate({
		requestId,
		requestPublisherId,
		payload,
	});

	return queryResponse;
}

describe('QueryResolutionState', () => {
	let primaryNodeMessages: StreamMessage[];
	let foreignNode1Messages: StreamMessage[];
	let foreignNode2Messages: StreamMessage[];

	describe('is not ready', () => {
		it('if neither primary nor foreign nodes provided the data', () => {
			const queryResolutionState = new QueryResolutionState([
				foreignNode1,
				foreignNode2,
			]);

			expect(queryResolutionState.isReady).toBe(false);
		});

		it('if the primary node provided the data but not the foreign node', () => {
			const queryResolutionState = new QueryResolutionState([foreignNode1]);

			primaryNodeMessages = [messageA, messageB, messageC];

			queryResolutionState.setPrimaryHashMap(buildHashMap(primaryNodeMessages));

			expect(queryResolutionState.isReady).toBe(false);
		});

		it('if all foreign nodes provided the data but not the primary node', () => {
			const queryResolutionState = new QueryResolutionState([
				foreignNode1,
				foreignNode2,
			]);

			foreignNode1Messages = [messageA, messageB, messageC];
			foreignNode2Messages = [messageA, messageB, messageC];

			queryResolutionState.addForeignResponse(
				foreignNode1,
				buildQueryResponse(foreignNode1Messages)
			);

			queryResolutionState.addForeignResponse(
				foreignNode2,
				buildQueryResponse(foreignNode2Messages)
			);

			expect(queryResolutionState.isReady).toBe(false);
		});

		it('if an extra foreign node provided the data but not primary', () => {
			const queryResolutionState = new QueryResolutionState([foreignNode1]);

			foreignNode1Messages = [messageA, messageB, messageC];
			foreignNode2Messages = [messageA, messageB, messageC];

			queryResolutionState.addForeignResponse(
				foreignNode1,
				buildQueryResponse(foreignNode1Messages)
			);

			queryResolutionState.addForeignResponse(
				foreignNode2,
				buildQueryResponse(foreignNode2Messages)
			);

			expect(queryResolutionState.isReady).toBe(false);
		});

		it('if primary node has lacking messages', () => {
			const queryResolutionState = new QueryResolutionState([foreignNode1]);

			primaryNodeMessages = [messageA];
			foreignNode1Messages = [messageA, messageB];

			queryResolutionState.setPrimaryHashMap(buildHashMap(primaryNodeMessages));

			queryResolutionState.addForeignResponse(
				foreignNode1,
				buildQueryResponse(foreignNode1Messages)
			);

			expect(queryResolutionState.isReady).toBe(false);
		});

		it('if primary node has lacking and extra messages', () => {
			const queryResolutionState = new QueryResolutionState([foreignNode1]);

			primaryNodeMessages = [messageA, messageB];
			foreignNode1Messages = [messageA, messageC];

			queryResolutionState.setPrimaryHashMap(buildHashMap(primaryNodeMessages));

			queryResolutionState.addForeignResponse(
				foreignNode1,
				buildQueryResponse(foreignNode1Messages)
			);

			expect(queryResolutionState.isReady).toBe(false);
		});
	});

	describe('is ready', () => {
		it('if no online nodes provided', () => {
			const queryResolutionState = new QueryResolutionState([]);

			expect(queryResolutionState.isReady).toBe(true);
		});

		it('if the primary node has the same messages as the foreign nodes', () => {
			const queryResolutionState = new QueryResolutionState([
				foreignNode1,
				foreignNode2,
			]);

			primaryNodeMessages = [messageA, messageB, messageC];
			foreignNode1Messages = [messageA, messageB, messageC];
			foreignNode2Messages = [messageA, messageB, messageC];

			queryResolutionState.setPrimaryHashMap(buildHashMap(primaryNodeMessages));

			queryResolutionState.addForeignResponse(
				foreignNode1,
				buildQueryResponse(foreignNode1Messages)
			);

			queryResolutionState.addForeignResponse(
				foreignNode2,
				buildQueryResponse(foreignNode2Messages)
			);

			expect(queryResolutionState.isReady).toBe(true);
		});

		it('if the primary node has more messages than the foreign nodes', () => {
			const queryResolutionState = new QueryResolutionState([
				foreignNode1,
				foreignNode2,
			]);

			primaryNodeMessages = [messageA, messageB, messageC];
			foreignNode1Messages = [messageB, messageC];
			foreignNode2Messages = [messageA, messageC];

			queryResolutionState.setPrimaryHashMap(buildHashMap(primaryNodeMessages));

			queryResolutionState.addForeignResponse(
				foreignNode1,
				buildQueryResponse(foreignNode1Messages)
			);

			queryResolutionState.addForeignResponse(
				foreignNode2,
				buildQueryResponse(foreignNode2Messages)
			);

			expect(queryResolutionState.isReady).toBe(true);
		});

		it('if the primary node is the only node that has messages', () => {
			const queryResolutionState = new QueryResolutionState([
				foreignNode1,
				foreignNode2,
			]);

			primaryNodeMessages = [messageA, messageB, messageC];
			foreignNode1Messages = [];
			foreignNode2Messages = [];

			queryResolutionState.setPrimaryHashMap(buildHashMap(primaryNodeMessages));

			queryResolutionState.addForeignResponse(
				foreignNode1,
				buildQueryResponse(foreignNode1Messages)
			);

			queryResolutionState.addForeignResponse(
				foreignNode2,
				buildQueryResponse(foreignNode2Messages)
			);

			expect(queryResolutionState.isReady).toBe(true);
		});

		it('when the foreign node propagates the missing messages', () => {
			const queryResolutionState = new QueryResolutionState([foreignNode1]);

			primaryNodeMessages = [];
			foreignNode1Messages = [messageA];

			queryResolutionState.setPrimaryHashMap(buildHashMap(primaryNodeMessages));

			queryResolutionState.addForeignResponse(
				foreignNode1,
				buildQueryResponse(foreignNode1Messages)
			);

			queryResolutionState.addPropagation(
				foreignNode1,
				buildQueryPropagation([messageA])
			);

			expect(queryResolutionState.isReady).toBe(true);
		});

		it('when the foreign nodes propagate the missing messages', () => {
			const queryResolutionState = new QueryResolutionState([
				foreignNode1,
				foreignNode2,
			]);

			primaryNodeMessages = [messageA];
			foreignNode1Messages = [messageA, messageB];
			foreignNode2Messages = [messageA, messageC];

			queryResolutionState.setPrimaryHashMap(buildHashMap(primaryNodeMessages));

			queryResolutionState.addForeignResponse(
				foreignNode1,
				buildQueryResponse(foreignNode1Messages)
			);

			queryResolutionState.addForeignResponse(
				foreignNode2,
				buildQueryResponse(foreignNode2Messages)
			);

			queryResolutionState.addPropagation(
				foreignNode1,
				buildQueryPropagation([messageB])
			);

			queryResolutionState.addPropagation(
				foreignNode2,
				buildQueryPropagation([messageC])
			);

			expect(queryResolutionState.isReady).toBe(true);
		});
	});
});
