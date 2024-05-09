import {
	QueryPropagate,
	QueryRangeOptions,
	QueryRequest,
	QueryResponse,
	QueryType,
} from '@logsn/protocol';
import { MessageRef } from '@streamr/protocol';
import { convertBytesToStreamMessage } from '@streamr/trackerless-network';
import { EthereumAddress, Logger } from '@streamr/utils';
import { PassThrough, pipeline, Readable } from 'stream';

import { Chunker, ChunkerCallback } from '../Chunker';
import { DatabaseAdapter } from '../database/DatabaseAdapter';
import {
	MAX_SEQUENCE_NUMBER_VALUE,
	MAX_TIMESTAMP_VALUE,
	MIN_SEQUENCE_NUMBER_VALUE,
} from '../LogStore';
import { AggreagationList } from './AggregationList';

const logger = new Logger(module);

export class Aggregator extends PassThrough {
	private readonly database: DatabaseAdapter;
	private readonly queryRequest: QueryRequest;

	private readonly foreignNodeResponses: Map<
		EthereumAddress,
		{ messageRef: MessageRef | undefined; isFinalized: boolean }
	>;
	private readonly aggreagationList: AggreagationList;
	private readonly queryStreams: Set<Readable>;

	constructor(
		database: DatabaseAdapter,
		queryRequest: QueryRequest,
		foreignNodes: EthereumAddress[],
		chunkCallback: ChunkerCallback<Uint8Array>
	) {
		super({ objectMode: true });

		this.database = database;
		this.queryRequest = queryRequest;

		this.foreignNodeResponses = new Map<
			EthereumAddress,
			{ messageRef: MessageRef | undefined; isFinalized: boolean }
		>(
			foreignNodes.map((node) => [
				node,
				{ messageRef: undefined, isFinalized: false },
			])
		);
		this.aggreagationList = new AggreagationList();
		this.queryStreams = new Set<Readable>();

		let queryStream: Readable;
		switch (this.queryRequest.queryOptions.queryType) {
			case QueryType.Last:
				queryStream = this.database.queryLast(
					this.queryRequest.streamId,
					this.queryRequest.partition,
					this.queryRequest.queryOptions.last
				);
				break;
			case QueryType.From:
				queryStream = this.database.queryRange(
					this.queryRequest.streamId,
					this.queryRequest.partition,
					this.queryRequest.queryOptions.from.timestamp,
					this.queryRequest.queryOptions.from.sequenceNumber ??
						MIN_SEQUENCE_NUMBER_VALUE,
					MAX_TIMESTAMP_VALUE,
					MAX_SEQUENCE_NUMBER_VALUE,
					this.queryRequest.queryOptions.publisherId,
					undefined
				);
				break;
			case QueryType.Range:
				queryStream = this.database.queryRange(
					this.queryRequest.streamId,
					this.queryRequest.partition,
					this.queryRequest.queryOptions.from.timestamp,
					this.queryRequest.queryOptions.from.sequenceNumber ??
						MIN_SEQUENCE_NUMBER_VALUE,
					this.queryRequest.queryOptions.to.timestamp,
					this.queryRequest.queryOptions.to.sequenceNumber ??
						MAX_SEQUENCE_NUMBER_VALUE,
					this.queryRequest.queryOptions.publisherId,
					this.queryRequest.queryOptions.msgChainId
				);
				break;
		}

		this.queryStreams.add(queryStream);

		queryStream.on('data', (bytes: Uint8Array) => {
			const message = convertBytesToStreamMessage(bytes);
			const messageRef = message.messageId.toMessageRef();
			this.aggreagationList.push(messageRef, true);
			this.doCheck();
		});
		queryStream.on('end', () => {
			this.queryStreams.delete(queryStream);
			this.doCheck();
		});
		queryStream.on('error', (err) => {
			this.queryStreams.delete(queryStream);
			// TODO: Handle error
			logger.error('query failed', { err });
		});

		pipeline(queryStream, new Chunker<Uint8Array>(chunkCallback), (err) => {
			if (err) {
				// TODO: Handle error
				logger.error('Pipeline failed', { err });
			}
		});
	}

	private get isWaitingForForeignNodes() {
		for (const {
			messageRef,
			isFinalized,
		} of this.foreignNodeResponses.values()) {
			if (!isFinalized && messageRef === undefined) {
				return true;
			}
		}

		return false;
	}

	private getOrCreateForeignNodeResponse(node: EthereumAddress) {
		let response = this.foreignNodeResponses.get(node);

		if (!response) {
			response = {
				messageRef: undefined,
				isFinalized: false,
			};
			this.foreignNodeResponses.set(node, response);
		}

		return response;
	}

	public onForeignResponse(node: EthereumAddress, response: QueryResponse) {
		const foreignNodeResponse = this.getOrCreateForeignNodeResponse(node);

		response.messageRefs.forEach((messageRef) => {
			this.aggreagationList.push(messageRef, false);
		});

		if (response.isFinal) {
			foreignNodeResponse.isFinalized = true;
		}

		this.doCheck();
	}

	public onPropagation(node: EthereumAddress, response: QueryPropagate) {
		Promise.all(
			response.payload.map(async (bytes: Uint8Array) => {
				const message = convertBytesToStreamMessage(bytes);
				await this.database.store(message);

				const messageRef = message.messageId.toMessageRef();
				this.aggreagationList.push(messageRef, true);
			})
		).then(() => {
			this.doCheck();
		});
	}

	private doCheck() {
		if (this.isWaitingForForeignNodes) {
			return;
		}

		if (this.aggreagationList.isEmpty && this.queryStreams.size === 0) {
			this.end();
			return;
		}

		const readyFrom = this.aggreagationList.readyFrom;
		const readyTo = this.aggreagationList.readyTo;

		if (readyFrom && readyTo) {
			// TODO: review the cast
			const queryRangeOptions = this.queryRequest
				.queryOptions as QueryRangeOptions;

			// TODO: Handle an errror if the pipe gets broken
			const queryStream = this.database.queryRange(
				this.queryRequest.streamId,
				this.queryRequest.partition,
				readyFrom.timestamp,
				readyFrom.sequenceNumber,
				readyTo.timestamp,
				readyTo.sequenceNumber,
				queryRangeOptions.publisherId,
				queryRangeOptions.msgChainId
			);

			this.queryStreams.add(queryStream);

			queryStream.on('end', () => {
				this.queryStreams.delete(queryStream);
				this.doCheck();
			});

			queryStream.pipe(this, { end: false });

			this.aggreagationList.shrink(readyTo);
		}
	}
}
