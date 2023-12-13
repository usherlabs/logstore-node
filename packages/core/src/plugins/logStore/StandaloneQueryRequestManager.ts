import {
	QueryFromOptions,
	QueryLastOptions,
	QueryRangeOptions,
	QueryRequest,
	QueryType,
} from '@logsn/protocol';
import { Logger } from '@streamr/utils';
import { Readable } from 'stream';

import {
	LogStore,
	MAX_SEQUENCE_NUMBER_VALUE,
	MIN_SEQUENCE_NUMBER_VALUE,
} from './LogStore';

const logger = new Logger(module);

export class StandaloneQueryRequestManager {
	private logStore?: LogStore;

	constructor() {
		//
	}

	public async start(logStore: LogStore) {
		this.logStore = logStore;
	}

	public getDataForQueryRequest(queryRequest: QueryRequest) {
		let readableStream: Readable;
		switch (queryRequest.queryType) {
			case QueryType.Last: {
				const { last } = queryRequest.queryOptions as QueryLastOptions;

				readableStream = this.logStore!.requestLast(
					queryRequest.streamId,
					queryRequest.partition,
					last
				);
				break;
			}
			case QueryType.From: {
				const { from, publisherId, limit } =
					queryRequest.queryOptions as QueryFromOptions;

				readableStream = this.logStore!.requestFrom(
					queryRequest.streamId,
					queryRequest.partition,
					from.timestamp,
					from.sequenceNumber || MIN_SEQUENCE_NUMBER_VALUE,
					publisherId,
					limit
				);
				break;
			}
			case QueryType.Range: {
				const { from, publisherId, to, msgChainId, limit } =
					queryRequest.queryOptions as QueryRangeOptions;

				readableStream = this.logStore!.requestRange(
					queryRequest.streamId,
					queryRequest.partition,
					from.timestamp,
					from.sequenceNumber || MIN_SEQUENCE_NUMBER_VALUE,
					to.timestamp,
					to.sequenceNumber || MAX_SEQUENCE_NUMBER_VALUE,
					publisherId,
					msgChainId,
					limit
				);
				break;
			}
			default:
				throw new Error('Unknown QueryType');
		}

		return readableStream;
	}
}
