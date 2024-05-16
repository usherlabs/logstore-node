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

export class PropagationManager {
	private clientId?: EthereumAddress;
	private database?: DatabaseAdapter;

	private propagators: Map<string, Propagator>;

	constructor(
		private readonly publisher: BroadbandPublisher,
		private readonly subscriber: BroadbandSubscriber
	) {
		this.propagators = new Map<string, Propagator>();
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
			case SystemMessageType.QueryRequest:
				this.onQueryRequest(systemMessage as QueryRequest, metadata);
				break;
			case SystemMessageType.QueryResponse:
				this.onQueryResponse(systemMessage as QueryResponse);
				break;
		}
	}

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

	private async onQueryResponse(queryResponse: QueryResponse) {
		const propagator = this.propagators.get(queryResponse.requestId);

		propagator?.onPrimaryResponse(queryResponse);
	}
}
