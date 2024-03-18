import { verify } from '@logsn/client';
import { QueryPropagate, QueryResponse } from '@logsn/protocol';
import { createSignaturePayload, StreamMessage } from '@streamr/protocol';
import { EthereumAddress } from '@streamr/utils';
import { ScalableBloomFilter } from 'bloom-filters';
import { keccak256 } from 'ethers/lib/utils';

type QueryMessageState<T> =
	| {
			state: 'awaiting';
	  }
	| {
			state: 'received';
			message: T;
	  }
	| {
			state: 'processed';
	  };

export class QueryResolutionState {
	private primaryHashMap?: Map<string, string>;
	private foreignResponses: Map<
		EthereumAddress,
		QueryMessageState<QueryResponse>
	>;
	private foreignPropagations: Map<
		EthereumAddress,
		QueryMessageState<QueryPropagate>
	>;
	private propagatedMessageIds: Map<string, boolean>;

	constructor(nodes: EthereumAddress[]) {
		this.foreignResponses = new Map(
			nodes.map((node) => [node, { state: 'awaiting' }])
		);
		this.foreignPropagations = new Map();
		this.propagatedMessageIds = new Map();
	}

	public setPrimaryHashMap(hashMap: Map<string, string>) {
		if (this.primaryHashMap) {
			throw new Error('Primary HashMap is already set');
		}

		this.primaryHashMap = hashMap;
		this.processResponses();
	}

	public addForeignResponse(node: EthereumAddress, response: QueryResponse) {
		this.foreignResponses.set(node, { state: 'received', message: response });
		this.processResponses();
	}

	public addPropagation(node: EthereumAddress, propagation: QueryPropagate) {
		this.foreignPropagations.set(node, {
			state: 'received',
			message: propagation,
		});

		return this.processPropagations();
	}

	private processResponses() {
		if (!this.primaryHashMap) {
			return;
		}

		for (const [node, response] of this.foreignResponses) {
			if (response.state !== 'received') {
				continue;
			}

			let hash = keccak256([]);
			const bloomFilter = ScalableBloomFilter.fromJSON(
				JSON.parse(response.message.bloomFilter)
			);

			for (const [_, messageHash] of this.primaryHashMap) {
				if (bloomFilter.has(messageHash)) {
					hash = keccak256(Uint8Array.from(Buffer.from(hash + messageHash)));
				}
			}

			if (hash !== response.message.hash) {
				this.foreignPropagations.set(node, { state: 'awaiting' });
			}

			this.foreignResponses.set(node, { state: 'processed' });
		}
	}

	private processPropagations() {
		const propagatedMessages = [];

		for (const [node, propagation] of this.foreignPropagations) {
			if (propagation.state !== 'received') {
				continue;
			}

			for (const [messageIdStr, serializedMessage] of propagation.message
				.payload) {
				if (this.propagatedMessageIds.has(messageIdStr)) {
					continue;
				}

				const isVerified = this.verifyPropagatedMessage(serializedMessage);
				if (isVerified) {
					propagatedMessages.push(serializedMessage);
					this.propagatedMessageIds.set(messageIdStr, true);
				}
			}

			this.foreignPropagations.set(node, { state: 'processed' });
		}

		return propagatedMessages;
	}

	private verifyPropagatedMessage(serializedMessage: string) {
		const message = StreamMessage.deserialize(serializedMessage);
		const messageId = message.getMessageID();
		const prevMsgRef = message.getPreviousMessageRef() ?? undefined;
		const newGroupKey = message.getNewGroupKey() ?? undefined;
		const serializedContent = message.getSerializedContent();

		const messagePayload = createSignaturePayload({
			messageId,
			serializedContent,
			prevMsgRef,
			newGroupKey,
		});

		const messagePublisherAddress = message.getPublisherId();
		const messageSignature = message.signature;

		return verify(messagePublisherAddress, messagePayload, messageSignature);
	}

	public get participatedNodes() {
		return Array.from(this.foreignResponses.entries())
			.filter(([_, response]) => response.state === 'processed')
			.map(([node]) => node);
	}

	private get pendingResponses() {
		return Array.from(this.foreignResponses.entries()).filter(
			([_, response]) => response.state !== 'processed'
		);
	}

	private get pendingPropagations() {
		return Array.from(this.foreignPropagations.entries()).filter(
			([_, response]) => response.state !== 'processed'
		);
	}

	public get isReady() {
		if (this.foreignResponses.size === 0) {
			return true;
		}

		return (
			this.pendingResponses.length === 0 &&
			this.pendingPropagations.length === 0
		);
	}
}
