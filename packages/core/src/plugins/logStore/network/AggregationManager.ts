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

export class AggregationManager {
	private clientId?: EthereumAddress;
	private database?: DatabaseAdapter;

	private aggregators: Map<string, Aggregator>;

	constructor(
		private readonly heartbeat: Heartbeat,
		private readonly publisher: BroadbandPublisher,
		private readonly subscriber: BroadbandSubscriber
	) {
		this.aggregators = new Map<string, Aggregator>();
	}

	public async start(clientId: EthereumAddress, database: DatabaseAdapter) {
		this.clientId = clientId;
		this.database = database;
		await this.subscriber.subscribe(this.onMessage.bind(this));
	}

	public async stop() {
		await this.subscriber.unsubscribe();
	}

	private async onMessage(content: unknown, metadata: MessageMetadata) {
		if (metadata.publisherId === this.clientId) {
			return;
		}

		const systemMessage = SystemMessage.deserialize(content);

		switch (systemMessage.messageType) {
			case SystemMessageType.QueryResponse:
				this.onQueryRequest(systemMessage as QueryResponse, metadata);
				break;
			case SystemMessageType.QueryPropagate:
				this.onQueryPropagate(systemMessage as QueryPropagate, metadata);
				break;
		}
	}

	private async onQueryRequest(
		queryResponse: QueryResponse,
		metadata: MessageMetadata
	) {
		const aggregator = this.aggregators.get(queryResponse.requestId);
		aggregator?.onForeignResponse(metadata.publisherId, queryResponse);
	}

	private async onQueryPropagate(
		queryPropagate: QueryPropagate,
		metadata: MessageMetadata
	) {
		const aggregator = this.aggregators.get(queryPropagate.requestId);
		aggregator?.onPropagation(metadata.publisherId, queryPropagate);
	}

	public aggregare(queryRequest: QueryRequest) {
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
