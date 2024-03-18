import {
	QueryRequest,
	QueryResponse,
	SystemMessage,
	SystemMessageType,
} from '@logsn/protocol';
import { createSignaturePayload, StreamMessage } from '@streamr/protocol';
import { Logger } from '@streamr/utils';
import { ScalableBloomFilter } from 'bloom-filters';
import { keccak256 } from 'ethers/lib/utils';
import { Readable } from 'stream';
import { MessageMetadata } from 'streamr-client';

import { BroadbandPublisher } from '../../../shared/BroadbandPublisher';
import { BroadbandSubscriber } from '../../../shared/BroadbandSubscriber';
import { BaseQueryRequestManager } from '../BaseQueryRequestManager';
import { LogStore } from '../LogStore';
import { PropagationResolver } from './PropagationResolver';
import { QueryResponseManager } from './QueryResponseManager';

const logger = new Logger(module);

export class NetworkQueryRequestManager extends BaseQueryRequestManager {
	constructor(
		private readonly queryResponseManager: QueryResponseManager,
		private readonly propagationResolver: PropagationResolver,
		private readonly publisher: BroadbandPublisher,
		private readonly subscriber: BroadbandSubscriber
	) {
		//
		super();
	}

	public override async start(logStore: LogStore) {
		super.start(logStore);
		await this.subscriber.subscribe(this.onMessage.bind(this));
	}

	public async stop() {
		await this.subscriber.unsubscribe();
	}

	private async onMessage(content: unknown, metadata: MessageMetadata) {
		const systemMessage = SystemMessage.deserialize(content);

		if (systemMessage.messageType !== SystemMessageType.QueryRequest) {
			return;
		}

		const queryRequest = systemMessage as QueryRequest;
		logger.debug('Received QueryRequest', {
			content,
			metadata,
		});
		const readableStream = this.getDataForQueryRequest(queryRequest);

		const { hash, hashMap, bloomFilter } = await this.getHashMap(
			readableStream
		);
		const queryResponse = new QueryResponse({
			requestId: queryRequest.requestId,
			requestPublisherId: metadata.publisherId,
			hash,
			// hashMap,
			bloomFilter: JSON.stringify(bloomFilter),
		});

		await this.queryResponseManager.publishQueryResponse(
			queryResponse,
			hashMap
		);
	}

	public async publishQueryRequestAndWaitForPropagateResolution(
		queryRequest: QueryRequest
	) {
		const resolutionPromise =
			this.propagationResolver.waitForPropagateResolution(queryRequest);
		await this.publisher.publish(queryRequest.serialize());
		return resolutionPromise;
	}

	private async getHashMap(data: Readable) {
		let hash = keccak256([]);
		const hashMap: Map<string, string> = new Map();
		const bloomFilter = new ScalableBloomFilter();

		for await (const chunk of data) {
			const streamMessage = chunk as StreamMessage;
			const payload = createSignaturePayload({
				messageId: streamMessage.getMessageID(),
				serializedContent: streamMessage.getSerializedContent(),
				prevMsgRef: streamMessage.prevMsgRef ?? undefined,
				newGroupKey: streamMessage.newGroupKey ?? undefined,
			});

			const messageId = streamMessage.getMessageID().serialize();
			const messageHash = keccak256(Uint8Array.from(Buffer.from(payload)));

			hash = keccak256(Uint8Array.from(Buffer.from(hash + messageHash)));
			hashMap.set(messageId, messageHash);
			bloomFilter.add(messageHash);
		}

		return { hash, hashMap, bloomFilter: bloomFilter.saveAsJSON() };
	}
}
