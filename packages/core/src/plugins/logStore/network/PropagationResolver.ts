import { verify } from '@logsn/client';
import {
	QueryPropagate,
	QueryRequest,
	QueryResponse,
	SystemMessage,
	SystemMessageType,
} from '@logsn/protocol';
import { createSignaturePayload, StreamMessage } from '@streamr/protocol';
import { EthereumAddress, Logger, toEthereumAddress } from '@streamr/utils';
import { MessageMetadata } from 'streamr-client';

import { BroadbandSubscriber } from '../../../shared/BroadbandSubscriber';
import { LogStore } from '../LogStore';
import { Heartbeat } from './Heartbeat';

const logger = new Logger(module);

type RequestId = string;
const TIMEOUT = 30 * 1000;
const RESPONSES_THRESHOLD = 1.0;

class QueryPropagationState {
	private primaryResponseHashMap: Map<string, string> | null = null;
	private awaitingMessageIds: Map<string, string>;
	public nodesResponseState: Map<EthereumAddress, boolean>;
	private foreignResponseBuffer: [QueryResponse, MessageMetadata][] = [];
	private propagateBuffer: QueryPropagate[] = [];
	public messagesReadyToBeStored: [string, string][] = [];

	constructor(onlineNodes: EthereumAddress[]) {
		this.awaitingMessageIds = new Map<string, string>();
		this.nodesResponseState = new Map<EthereumAddress, boolean>(
			onlineNodes.map((node) => [node, false])
		);
	}

	public onPrimaryQueryResponse(primaryResponse: QueryResponse) {
		// this should happen only once
		if (this.primaryResponseHashMap) {
			logger.error('Primary response already set');
			return;
		}

		this.nodesResponseState.set(
			toEthereumAddress(primaryResponse.requestPublisherId),
			true
		);

		this.primaryResponseHashMap = primaryResponse.hashMap;
		this.foreignResponseBuffer.forEach((args) =>
			this.onForeignQueryResponse(...args)
		);
		this.propagateBuffer.forEach((queryPropagate) =>
			this.onPropagate(queryPropagate)
		);
	}

	public onForeignQueryResponse(
		queryResponse: QueryResponse,
		metadata: MessageMetadata
	) {
		if (!this.primaryResponseHashMap) {
			this.foreignResponseBuffer.push([queryResponse, metadata]);
			return;
		}

		// We add here the messageIds that are not in the primary response
		for (const [messageId, messageHash] of queryResponse.hashMap) {
			if (!this.primaryResponseHashMap.has(messageId)) {
				this.awaitingMessageIds.set(messageId, messageHash);
			}
		}

		this.nodesResponseState.set(metadata.publisherId, true);
	}

	public onPropagate(queryPropagate: QueryPropagate) {
		if (!this.primaryResponseHashMap) {
			this.propagateBuffer.push(queryPropagate);
			// we don't have the primary response yet, so we can't verify the propagated messages and store them
			return;
		}
		for (const [messageIdStr, serializedMessage] of queryPropagate.payload) {
			if (this.awaitingMessageIds.has(messageIdStr)) {
				const isVerified = this.verifyPropagatedMessage(serializedMessage);
				if (isVerified) {
					this.messagesReadyToBeStored.push([messageIdStr, serializedMessage]);
				}

				// we delete the message from the awaiting list regardless of verification result
				this.awaitingMessageIds.delete(messageIdStr);
			}
		}
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

	/**
	 * We know if we are ready if we have received responses from sufficient nodes
	 * that previously said that this query was missing messages
	 */
	public get isReady() {
		// this means there's no one identified as online. This node is alone and there's no chance to receive a propagate.
		if (this.nodesResponseState.size === 0) {
			return true;
		}

		const respondedCount = Array.from(this.nodesResponseState.values()).filter(
			Boolean
		).length;
		const percentResponded = respondedCount / this.nodesResponseState.size;

		return (
			percentResponded >= RESPONSES_THRESHOLD &&
			this.awaitingMessageIds.size === 0
		);
	}
}

export class PropagationResolver {
	private readonly queryPropagationStateMap: Map<
		RequestId,
		QueryPropagationState
	>;
	private readonly queryCallbacks: Map<
		RequestId,
		(participatedNodes: string[]) => void
	>;
	private _logStore: LogStore | undefined;

	constructor(
		private readonly heartbeat: Heartbeat,
		private readonly subscriber: BroadbandSubscriber
	) {
		this.queryPropagationStateMap = new Map<RequestId, QueryPropagationState>();
		this.queryCallbacks = new Map<RequestId, () => void>();
	}

	public async start(logStore: LogStore) {
		this._logStore = logStore;
		await this.subscriber.subscribe(this.onMessage.bind(this));
	}

	private get logStore(): LogStore {
		if (!this._logStore) {
			throw new Error('LogStore not initialized');
		}
		return this._logStore;
	}

	public async stop() {
		await this.subscriber.unsubscribe();
	}

	public async waitForPropagateResolution(queryRequest: QueryRequest) {
		let timeout: NodeJS.Timeout;

		// Racing between timeout and finalization of the query
		return Promise.race([
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => {
					logger.warn('Propagation timeout on request', {
						requestId: queryRequest.requestId,
					});
					logger.debug('Current state of the query on timeout', {
						state: this.queryPropagationStateMap.get(queryRequest.requestId),
					});
					this.clean(queryRequest.requestId);
					reject('Propagation timeout');
				}, TIMEOUT);
			}),
			new Promise<{ participatingNodes: string[] }>((resolve) => {
				this.queryCallbacks.set(
					queryRequest.requestId,
					(participatingNodes) => {
						clearTimeout(timeout);
						resolve({ participatingNodes });
					}
				);
			}),
		]);
	}

	private onMessage(content: unknown, metadata: MessageMetadata) {
		const systemMessage = SystemMessage.deserialize(content);

		if (systemMessage.messageType !== SystemMessageType.QueryPropagate) {
			return;
		}

		this.onQueryPropagate(systemMessage as QueryPropagate, metadata);
	}

	/**
	 * These are responses produced by this own node running this code, which happens
	 * to be the primary node handling the request.
	 * @param queryResponse
	 */
	public setPrimaryResponse(queryResponse: QueryResponse) {
		const queryState = this.getOrCreateQueryState(queryResponse.requestId);
		queryState.onPrimaryQueryResponse(queryResponse);

		// it may be ready if there are no other nodes responding here
		this.finishIfReady(queryState, queryResponse.requestId);
	}

	private getOrCreateQueryState(requestId: RequestId) {
		const queryState =
			this.queryPropagationStateMap.get(requestId) ??
			new QueryPropagationState(this.heartbeat.onlineNodes);
		this.queryPropagationStateMap.set(requestId, queryState);
		return queryState;
	}

	/**
	 * These are responses produced by other nodes, trying to see if my response
	 * has any missing messages
	 * @param queryResponse
	 * @param metadata
	 */
	public setForeignResponse(
		queryResponse: QueryResponse,
		metadata: MessageMetadata
	) {
		const queryState = this.getOrCreateQueryState(queryResponse.requestId);
		queryState.onForeignQueryResponse(queryResponse, metadata);

		// May be ready if this response was the last one missing, and it produced
		// no propagation requirement
		this.finishIfReady(queryState, queryResponse.requestId);
	}

	private async onQueryPropagate(
		queryPropagate: QueryPropagate,
		metadata: MessageMetadata
	) {
		if (queryPropagate.requestPublisherId === metadata.publisherId) {
			return;
		}

		const queryState = this.queryPropagationStateMap.get(
			queryPropagate.requestId
		);
		if (!queryState) {
			return;
		}

		queryState.onPropagate(queryPropagate);
		// we copy, so any async operation don't cause racing conditions
		// making we store twice in meanwhile
		const messagesToBeStored = [...queryState.messagesReadyToBeStored];
		// we just don't want to process them twice
		queryState.messagesReadyToBeStored = [];

		// Because messages are batched by the BatchManager,
		// a promise returned by logStore.store() resolves when the batch stores.
		// Therefore, we call logStore.store() for all the messages, and await all the returned promises.
		//
		// ? As profiled in https://linear.app/usherlabs/issue/LABS-476/solve-insert-management-for-query-propagate#comment-f7f277df
		// All promises in the array resolve simultaneously once the Batch calls it's insert() method for the batched messages.
		await Promise.all(
			messagesToBeStored.map(([_, messageStr]) => {
				const message = StreamMessage.deserialize(messageStr);
				return this.logStore.store(message);
			})
		);

		// May be ready if this propagation was the last one missing.
		this.finishIfReady(queryState, queryPropagate.requestId);
	}

	// It may be ready if
	// - we received all necessary responses from sufficient nodes
	// - we have no more missing messages waiting for propagation.
	private finishIfReady(
		queryState: QueryPropagationState,
		requestId: RequestId
	) {
		if (queryState.isReady) {
			const callback = this.queryCallbacks.get(requestId);
			this.clean(requestId);
			if (callback) {
				callback(Array.from(queryState.nodesResponseState.keys()));
			}
		}
	}

	private clean(requestId: RequestId) {
		this.queryPropagationStateMap.delete(requestId);
		this.queryCallbacks.delete(requestId);
	}
}
