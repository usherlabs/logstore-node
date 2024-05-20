import {
	QueryPropagate,
	QueryRequest,
	QueryResponse,
	SystemMessage,
	SystemMessageType,
} from '@logsn/protocol';
import { MessageMetadata } from '@streamr/sdk';
import { convertBytesToStreamMessage } from '@streamr/trackerless-network';
import { EthereumAddress } from '@streamr/utils';

import { BroadbandPublisher } from '../../../shared/BroadbandPublisher';
import { BroadbandSubscriber } from '../../../shared/BroadbandSubscriber';
import { DatabaseAdapter } from '../database/DatabaseAdapter';
import { Propagator } from './Propagator';

/**
 * Manages the propagation of data from a foreign node to the primary node.
 */
export class PropagationManager {
	private clientId?: EthereumAddress;
	private database?: DatabaseAdapter;

	private propagators: Map<string, Propagator>;

	/**
	 * Constructs a new PropagationManager.
	 *
	 * @param {BroadbandPublisher} publisher - THe publisher for publishing system messages.
	 * @param {BroadbandSubscriber} subscriber - The subscriber for receiving system messages.
	 */
	constructor(
		private readonly publisher: BroadbandPublisher,
		private readonly subscriber: BroadbandSubscriber
	) {
		this.propagators = new Map<string, Propagator>();
	}

	/**
	 * Starts the propagation manager.
	 *
	 * @param {EthereumAddress} clientId - The client ID of the current node.
	 * @param {DatabaseAdapter} database - The database adapter for data access.
	 */
	public async start(clientId: EthereumAddress, database: DatabaseAdapter) {
		this.clientId = clientId;
		this.database = database;
		await this.subscriber.subscribe(this.onMessage.bind(this));
	}

	/**
	 * Stops the propagation manager.
	 */
	public async stop() {
		await this.subscriber.unsubscribe();
	}

	/**
	 * Handles incoming messages, processing them based on their type.
	 *
	 * @param {unknown} content - The content of the message.
	 * @param {MessageMetadata} metadata - The metadata of the message.
	 */
	private async onMessage(content: unknown, metadata: MessageMetadata) {
		if (metadata.publisherId === this.clientId) {
			return;
		}

		const systemMessage = SystemMessage.deserialize(content);

		switch (systemMessage.messageType) {
			case SystemMessageType.QueryRequest:
				await this.onQueryRequest(systemMessage as QueryRequest, metadata);
				break;
			case SystemMessageType.QueryResponse:
				await this.onQueryResponse(systemMessage as QueryResponse, metadata);
				break;
		}
	}

	/**
	 * Handles a QueryRequest message, creating and storing a new propagator.
	 *
	 * @param {QueryRequest} queryRequest - The query request to handle.
	 * @param {MessageMetadata} metadata - The metadata of the message.
	 */
	private async onQueryRequest(
		queryRequest: QueryRequest,
		metadata: MessageMetadata
	) {
		const propagator = new Propagator(
			this.database!,
			queryRequest,
			async (serializedMessages, isFinal) => {
				const messageRefs = serializedMessages.map((serializedMessage) =>
					convertBytesToStreamMessage(serializedMessage).getMessageRef()
				);
				const queryResponse = new QueryResponse({
					requestId: queryRequest.requestId,
					requestPublisherId: metadata.publisherId,
					messageRefs,
					isFinal,
				});

				await this.publisher.publish(queryResponse.serialize());
			},
			async (payload) => {
				const queryPropagate = new QueryPropagate({
					requestId: queryRequest.requestId,
					requestPublisherId: metadata.publisherId,
					payload,
				});

				await this.publisher.publish(queryPropagate.serialize());
			},
			() => {
				this.propagators.delete(queryRequest.requestId);
			}
		);

		this.propagators.set(queryRequest.requestId, propagator);
	}

	/**
	 * Handles a QueryResponse message, delegating to the appropriate propagator.
	 *
	 * @param {QueryResponse} queryResponse - The query response to handle.
	 * @param {MessageMetadata} metadata - The metadata of the message.
	 */
	private async onQueryResponse(
		queryResponse: QueryResponse,
		metadata: MessageMetadata
	) {
		if (queryResponse.requestPublisherId !== metadata.publisherId) {
			return;
		}

		const propagator = this.propagators.get(queryResponse.requestId);

		propagator?.onPrimaryResponse(queryResponse);
	}
}
