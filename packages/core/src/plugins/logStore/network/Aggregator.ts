import {
	QueryPropagate,
	QueryRangeOptions,
	QueryRequest,
	QueryResponse,
	QueryType,
} from '@logsn/protocol';
import { MessageRef, toStreamID } from '@streamr/protocol';
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
import { AggregationList } from './AggregationList';

const logger = new Logger(module);

/**
 * The Aggregator class handles and processes data queries in a streaming fashion,
 * aggregating results from both a local database and remote (foreign) nodes.
 *
 * @extends PassThrough
 */
export class Aggregator extends PassThrough {
	private readonly database: DatabaseAdapter;
	private readonly queryRequest: QueryRequest;

	private readonly foreignNodeResponses: Map<
		EthereumAddress,
		{ messageRef: MessageRef | undefined; isFinalized: boolean }
	>;
	private readonly aggregationList: AggregationList;
	private readonly queryStreams: Set<Readable>;

	/**
	 * Initializes the Aggregator with a database adapter, query request,
	 * list of foreign nodes, and a callback for chunk processing.
	 *
	 * @param {DatabaseAdapter} database - The database adapter for querying local data.
	 * @param {QueryRequest} queryRequest - The query request specifying the data to retrieve.
	 * @param {EthereumAddress[]} foreignNodes - A list of foreign nodes to compare data to.
	 * @param {ChunkerCallback<Uint8Array>} chunkCallback - A callback for chunk processing.
	 */
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
		this.aggregationList = new AggregationList();
		this.queryStreams = new Set<Readable>();

		const streamId = toStreamID(this.queryRequest.streamId);

		let queryStream: Readable;
		switch (this.queryRequest.queryOptions.queryType) {
			case QueryType.Last:
				queryStream = this.database.queryLast(
					streamId,
					this.queryRequest.partition,
					this.queryRequest.queryOptions.last
				);
				break;
			case QueryType.From:
				queryStream = this.database.queryRange(
					streamId,
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
					streamId,
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
			this.aggregationList.pushPrimary(messageRef);
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

	/**
	 * Check if waiting for responses from foreign nodes.
	 *
	 * @returns {boolean} True if waiting for foreign nodes, otherwise false.
	 */
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

	/**
	 * Get or create a response status object for a foreign node.
	 *
	 * @param {EthereumAddress} node - The foreign node address.
	 * @returns {Object} The response status object for the foreign node.
	 */
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

	/**
	 * Handle QueryResponse messages from foreign nodes.
	 *
	 * @param {EthereumAddress} node - The foreign node address.
	 * @param {QueryResponse} response - The query response from the foreign node.
	 */
	public onForeignResponse(node: EthereumAddress, response: QueryResponse) {
		const foreignNodeResponse = this.getOrCreateForeignNodeResponse(node);

		response.messageRefs.forEach((messageRef) => {
			this.aggregationList.pushForeign(messageRef);
		});

		if (response.isFinal) {
			foreignNodeResponse.isFinalized = true;
		}

		this.doCheck();
	}

	/**
	 * Handle QueryPropagate messages from foreign nodes.
	 *
	 * @param {EthereumAddress} node - The foreign node address.
	 * @param {QueryPropagate} response - The propagation response from the foreign node.
	 */
	public onPropagation(node: EthereumAddress, response: QueryPropagate) {
		Promise.all(
			response.payload.map(async (bytes: Uint8Array) => {
				const message = convertBytesToStreamMessage(bytes);
				await this.database.store(message);

				const messageRef = message.messageId.toMessageRef();
				this.aggregationList.pushPropagation(messageRef);
			})
		).then(() => {
			this.doCheck();
		});
	}

	/**
	 * Check the state of aggregation and process accordingly.
	 */
	private doCheck() {
		if (this.isWaitingForForeignNodes) {
			return;
		}

		if (this.aggregationList.isEmpty && this.queryStreams.size === 0) {
			this.end();
			return;
		}

		const readyFrom = this.aggregationList.readyFrom;
		const readyTo = this.aggregationList.readyTo;

		if (readyFrom && readyTo) {
			// TODO: review the cast
			const queryRangeOptions = this.queryRequest
				.queryOptions as QueryRangeOptions;

			// TODO: Handle an error if the pipe gets broken
			const queryStream = this.database.queryRange(
				toStreamID(this.queryRequest.streamId),
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

			this.aggregationList.shrink(readyTo);
		}
	}
}
