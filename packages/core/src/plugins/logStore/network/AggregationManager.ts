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
import { Aggregator } from './Aggregator';
import { Heartbeat } from './Heartbeat';

/**
 * The AggregationManager class manages multiple Aggregator instances,
 * coordinates message handling, and oversees the aggregation process
 * across multiple nodes.
 */
export class AggregationManager {
	private clientId?: EthereumAddress;
	private database?: DatabaseAdapter;

	private aggregators: Map<string, Aggregator>;

	/**
	 * Creates an instance of AggregationManager.
	 *
	 * @param {Heartbeat} heartbeat - The heartbeat service for monitoring online nodes.
	 * @param {BroadbandPublisher} publisher - THe publisher for publishing system messages.
	 * @param {BroadbandSubscriber} subscriber - The subscriber for receiving system messages.
	 */
	constructor(
		private readonly heartbeat: Heartbeat,
		private readonly publisher: BroadbandPublisher,
		private readonly subscriber: BroadbandSubscriber
	) {
		this.aggregators = new Map<string, Aggregator>();
	}

	/**
	 * Starts the aggregation manager.
	 *
	 * @param {EthereumAddress} clientId - The client ID of the current node.
	 * @param {DatabaseAdapter} database - The database adapter for data queries.
	 * @returns {Promise<void>}
	 */
	public async start(clientId: EthereumAddress, database: DatabaseAdapter) {
		this.clientId = clientId;
		this.database = database;
		await this.subscriber.subscribe(this.onMessage.bind(this));
	}

	/**
	 * Stops the aggregation manager.
	 *
	 * @returns {Promise<void>}
	 */
	public async stop() {
		await this.subscriber.unsubscribe();
	}

	/**
	 * Handles incoming messages and delegates processing based on message type.
	 *
	 * @param {unknown} content - The content of the message.
	 * @param {MessageMetadata} metadata - The Metadata of the message.
	 * @private
	 */
	private async onMessage(content: unknown, metadata: MessageMetadata) {
		if (metadata.publisherId === this.clientId) {
			return;
		}

		const systemMessage = SystemMessage.deserialize(content);

		switch (systemMessage.messageType) {
			case SystemMessageType.QueryResponse:
				await this.onQueryRequest(systemMessage as QueryResponse, metadata);
				break;
			case SystemMessageType.QueryPropagate:
				await this.onQueryPropagate(systemMessage as QueryPropagate, metadata);
				break;
		}
	}

	/**
	 * Handles a QueryResponse messages from foreign nodes.
	 *
	 * @param {QueryResponse} queryResponse - The query response from a foreign node.
	 * @param {MessageMetadata} metadata - The Metadata of the message.
	 * @private
	 */
	private async onQueryRequest(
		queryResponse: QueryResponse,
		metadata: MessageMetadata
	) {
		const aggregator = this.aggregators.get(queryResponse.requestId);
		aggregator?.onForeignResponse(metadata.publisherId, queryResponse);
	}

	/**
	 * Handles a QueryPropagate messages from foreign nodes.
	 *
	 * @param {QueryPropagate} queryPropagate - The query propagate message from a foreign node.
	 * @param {MessageMetadata} metadata - The Metadata of the message.
	 * @private
	 */
	private async onQueryPropagate(
		queryPropagate: QueryPropagate,
		metadata: MessageMetadata
	) {
		const aggregator = this.aggregators.get(queryPropagate.requestId);
		aggregator?.onPropagation(metadata.publisherId, queryPropagate);
	}

	/**
	 * Creates a new Aggregator for the given query request and starts the aggregation process.
	 *
	 * @param {QueryRequest} queryRequest - The query request to aggregate data for.
	 * @returns {Aggregator} The created Aggregator instance.
	 */
	public aggregate(queryRequest: QueryRequest) {
		const aggregator = new Aggregator(
			this.database!,
			queryRequest,
			this.heartbeat.onlineNodes,
			async (serializedMessages: Uint8Array[], isFinal: boolean) => {
				const messageRefs = serializedMessages.map((serializedMessage) =>
					convertBytesToStreamMessage(
						serializedMessage
					).messageId.toMessageRef()
				);

				const queryResponse = new QueryResponse({
					requestId: queryRequest.requestId,
					requestPublisherId: this.clientId!,
					messageRefs,
					isFinal,
				});
				await this.publisher.publish(queryResponse.serialize());
			}
		);

		aggregator.on('close', () => {
			this.aggregators.delete(queryRequest.requestId);
		});

		this.aggregators.set(queryRequest.requestId, aggregator);

		return aggregator;
	}
}
