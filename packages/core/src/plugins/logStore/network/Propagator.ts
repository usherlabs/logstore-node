import { QueryRequest, QueryResponse, QueryType } from '@logsn/protocol';
import { toStreamID } from '@streamr/protocol';
import { convertBytesToStreamMessage } from '@streamr/trackerless-network';
import { Logger } from '@streamr/utils';
import { PassThrough, pipeline, Readable } from 'stream';

import { Chunker, ChunkerCallback } from '../Chunker';
import { DatabaseAdapter } from '../database/DatabaseAdapter';
import {
	MAX_SEQUENCE_NUMBER_VALUE,
	MAX_TIMESTAMP_VALUE,
	MIN_SEQUENCE_NUMBER_VALUE,
} from '../LogStore';
import { PropagationList } from './PropagationList';

const logger = new Logger(module);

/**
 * The Propagator class handles the propagation of missing data from
 * the foreign node to the primary node, and manages the streaming
 * of the propagating data.
 */
export class Propagator {
	private readonly database: DatabaseAdapter;
	private readonly queryRequest: QueryRequest;

	private readonly propagationList: PropagationList;
	private readonly propagationStream: PassThrough;
	private readonly queryStreams: Set<Readable> = new Set<Readable>();

	/**
	 * Creates an instance of Propagator.
	 *
	 * @param {DatabaseAdapter} database - The database adapter for data queries.
	 * @param {QueryRequest} queryRequest - The query request to process.
	 * @param {ChunkerCallback<Uint8Array>} responseChunkCallback - Callback for handling response chunks.
	 * @param {ChunkerCallback<Uint8Array>} propagationChunkCallback - Callback for handling propagation chunks.
	 * @param {() => void} closeCallback - Callback to execute when the stream closes.
	 */
	constructor(
		database: DatabaseAdapter,
		queryRequest: QueryRequest,
		responseChunkCallback: ChunkerCallback<Uint8Array>,
		propagationChunkCallback: ChunkerCallback<Uint8Array>,
		closeCallback: () => void
	) {
		this.database = database;
		this.queryRequest = queryRequest;

		this.propagationList = new PropagationList();
		this.propagationStream = new PassThrough({ objectMode: true });
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

		queryStream.on('data', (bytes: Uint8Array) => {
			const message = convertBytesToStreamMessage(bytes);
			this.propagationList.pushForeign(message.messageId.toMessageRef());
			this.doCheck();
		});
		queryStream.on('end', () => {
			this.propagationList.finalizeForeign();
			this.doCheck();
		});

		pipeline(
			queryStream,
			new Chunker<Uint8Array>(responseChunkCallback),
			(err) => {
				if (err) {
					// TODO: Handle error
					logger.error('Pipeline failed', { err });
				}
			}
		);

		pipeline(
			this.propagationStream,
			new Chunker<Uint8Array>(propagationChunkCallback),
			(err) => {
				if (err) {
					// TODO: Handle error
					logger.error('Pipeline failed', { err });
				}

				closeCallback();
			}
		);
	}

	/**
	 * Handles primary response messages by pushing them to the propagation list.
	 *
	 * @param {QueryResponse} response - The query response from a primary node.
	 */
	public onPrimaryResponse(response: QueryResponse) {
		response.messageRefs.forEach((messageRef) => {
			this.propagationList.pushPrimary(messageRef);
		});

		if (response.isFinal) {
			this.propagationList.finalizePrimary();
		}

		this.doCheck();
	}

	/**
	 * Checks the propagation list and queries the database for message references.
	 *
	 * @private
	 */
	private doCheck() {
		const messageRefs = this.propagationList.getDiffAndShrink();

		if (messageRefs.length) {
			const queryStream = this.database.queryByMessageRefs(
				toStreamID(this.queryRequest.streamId),
				this.queryRequest.partition,
				messageRefs
			);
			this.queryStreams.add(queryStream);

			queryStream.on('end', () => {
				this.queryStreams.delete(queryStream);
				this.doCheck();
			});
			queryStream.on('error', (err) => {
				// TODO: Handle error
				logger.error('query failed', { err });
			});

			queryStream.pipe(this.propagationStream, {
				end: this.propagationList.isFinalized,
			});
		} else if (
			this.propagationList.isFinalized &&
			this.queryStreams.size === 0
		) {
			this.propagationStream.end();
		}

		// TODO: Handle an error if the pipe gets broken
	}
}
