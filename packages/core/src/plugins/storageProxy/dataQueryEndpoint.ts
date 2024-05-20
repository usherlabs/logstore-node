/**
 * Endpoints for RESTful data requests
 */
import LogStoreClient from '@logsn/client';
import {
	Logger,
	MetricsContext,
	MetricsDefinition,
	RateMetric,
	toLengthPrefixedFrame,
} from '@streamr/utils';
import { Request, RequestHandler, Response } from 'express';
import { pipeline, Readable } from 'stream';

import { HttpServerEndpoint } from '../../Plugin';
import { Format } from '../logStore/http/DataQueryFormat';
import { ResponseTransform } from '../logStore/http/dataTransformers';

const logger = new Logger(module);

// TODO: move this to protocol-js
export const MIN_SEQUENCE_NUMBER_VALUE = 0;
export const MAX_SEQUENCE_NUMBER_VALUE = 2147483647;

function parseIntIfExists(x: string | undefined): number | undefined {
	return x === undefined ? undefined : parseInt(x);
}

const sendSuccess = (
	data: Readable,
	format: Format,
	streamId: string,
	res: Response
) => {
	data.once('data', () => {
		res.writeHead(200, {
			'Content-Type': format.contentType,
		});
	});
	data.once('error', (err) => {
		if (!res.headersSent) {
			res.status(500).json({
				error: 'Failed to fetch data!',
				err,
			});
		}
	});
	pipeline(data, new ResponseTransform(format), res, (err) => {
		if (err !== undefined && err !== null) {
			logger.error('Encountered error in pipeline', {
				streamId,
				err,
			});
		}
	});
};

const sendError = (message: string, res: Response) => {
	res.status(400).json({
		error: message,
	});
};

type BaseRequest<Q> = Request<
	Record<string, any>,
	any,
	any,
	Q,
	Record<string, any>
>;

type LastRequest = BaseRequest<{
	count?: string;
}>;

type FromRequest = BaseRequest<{
	fromTimestamp?: string;
	fromSequenceNumber?: string;
	publisherId?: string;
}>;

type RangeRequest = BaseRequest<{
	fromTimestamp?: string;
	toTimestamp?: string;
	fromSequenceNumber?: string;
	toSequenceNumber?: string;
	publisherId?: string;
	msgChainId?: string;
	fromOffset?: string; // no longer supported
	toOffset?: string; // no longer supported
}>;

const createBinaryFormat = (
	formatMessage: (bytes: Uint8Array) => Uint8Array
): Format => {
	return {
		formatMessage,
		contentType: 'application/octet-stream',
	};
};

const handleLast = async (
	req: LastRequest,
	streamId: string,
	partition: number,
	format: Format,
	res: Response,
	logStoreClient: LogStoreClient,
	metrics: MetricsDefinition
) => {
	metrics.resendLastQueriesPerSecond.record(1);
	const count =
		req.query.count === undefined ? 1 : parseIntIfExists(req.query.count);
	if (Number.isNaN(count)) {
		sendError(`Query parameter "count" not a number: ${req.query.count}`, res);
		return;
	}
	const data = await logStoreClient.query(
		{ streamId, partition },
		{ last: count! },
		undefined,
		{ raw: true }
	);

	sendSuccess(Readable.from(data.messageStream), format, streamId, res);
};

const handleFrom = async (
	req: FromRequest,
	streamId: string,
	partition: number,
	format: Format,
	res: Response,
	logStoreClient: LogStoreClient,
	metrics: MetricsDefinition
) => {
	metrics.resendFromQueriesPerSecond.record(1);
	const fromTimestamp = parseIntIfExists(req.query.fromTimestamp);
	const fromSequenceNumber =
		parseIntIfExists(req.query.fromSequenceNumber) ?? MIN_SEQUENCE_NUMBER_VALUE;
	const { publisherId } = req.query;
	if (fromTimestamp === undefined) {
		sendError('Query parameter "fromTimestamp" required.', res);
		return;
	}
	if (Number.isNaN(fromTimestamp)) {
		sendError(
			`Query parameter "fromTimestamp" not a number: ${req.query.fromTimestamp}`,
			res
		);
		return;
	}

	const data = await logStoreClient.query(
		{ streamId, partition },
		{
			from: {
				timestamp: fromTimestamp,
				sequenceNumber: fromSequenceNumber,
			},
			publisherId,
		},
		undefined,
		{ raw: true }
	);

	sendSuccess(Readable.from(data.messageStream), format, streamId, res);
};

const handleRange = async (
	req: RangeRequest,
	streamId: string,
	partition: number,
	format: Format,
	res: Response,
	logStoreClient: LogStoreClient,
	metrics: MetricsDefinition
) => {
	metrics.resendRangeQueriesPerSecond.record(1);
	const fromTimestamp = parseIntIfExists(req.query.fromTimestamp);
	const toTimestamp = parseIntIfExists(req.query.toTimestamp);
	const fromSequenceNumber =
		parseIntIfExists(req.query.fromSequenceNumber) ?? MIN_SEQUENCE_NUMBER_VALUE;
	const toSequenceNumber =
		parseIntIfExists(req.query.toSequenceNumber) ?? MAX_SEQUENCE_NUMBER_VALUE;
	const { publisherId, msgChainId } = req.query;
	if (req.query.fromOffset !== undefined || req.query.toOffset !== undefined) {
		sendError(
			'Query parameters "fromOffset" and "toOffset" are no longer supported. Please use "fromTimestamp" and "toTimestamp".',
			res
		);
		return;
	}
	if (fromTimestamp === undefined) {
		sendError('Query parameter "fromTimestamp" required.', res);
		return;
	}
	if (Number.isNaN(fromTimestamp)) {
		sendError(
			`Query parameter "fromTimestamp" not a number: ${req.query.fromTimestamp}`,
			res
		);
		return;
	}
	if (toTimestamp === undefined) {
		// eslint-disable-next-line max-len
		sendError(
			'Query parameter "toTimestamp" required as well. To request all messages since a timestamp, use the endpoint /streams/:id/data/partitions/:partition/from',
			res
		);
		return;
	}
	if (Number.isNaN(toTimestamp)) {
		sendError(
			`Query parameter "toTimestamp" not a number: ${req.query.toTimestamp}`,
			res
		);
		return;
	}
	if ((publisherId && !msgChainId) || (!publisherId && msgChainId)) {
		sendError('Invalid combination of "publisherId" and "msgChainId"', res);
		return;
	}

	const data = await logStoreClient.query(
		{ streamId, partition },
		{
			from: {
				timestamp: fromTimestamp,
				sequenceNumber: fromSequenceNumber,
			},
			to: {
				timestamp: toTimestamp,
				sequenceNumber: toSequenceNumber,
			},
			publisherId,
			msgChainId,
		},
		undefined,
		{ raw: true }
	);

	sendSuccess(Readable.from(data.messageStream), format, streamId, res);
};

const createHandler = (
	logStoreClient: LogStoreClient,
	metrics: MetricsDefinition
): RequestHandler => {
	return async (req: Request, res: Response) => {
		try {
			if (Number.isNaN(parseInt(req.params.partition))) {
				sendError(
					`Path parameter "partition" not a number: ${req.params.partition}`,
					res
				);
				return;
			}
			const format = createBinaryFormat(toLengthPrefixedFrame);

			const streamId = req.params.id;
			const partition = parseInt(req.params.partition);

			switch (req.params.resendType) {
				case 'last': {
					handleLast(
						req,
						streamId,
						partition,
						format,
						res,
						logStoreClient,
						metrics
					);
					break;
				}
				case 'from':
					handleFrom(
						req,
						streamId,
						partition,
						format,
						res,
						logStoreClient,
						metrics
					);
					break;
				case 'range':
					handleRange(
						req,
						streamId,
						partition,
						format,
						res,
						logStoreClient,
						metrics
					);
					break;
				default:
					sendError('Unknown resend type', res);
					break;
			}
		} catch (err) {
			logger.error('Error', { err });
		}
	};
};

export const createDataQueryEndpoint = (
	logStoreClient: LogStoreClient,
	metricsContext: MetricsContext
): HttpServerEndpoint => {
	const metrics = {
		resendLastQueriesPerSecond: new RateMetric(),
		resendFromQueriesPerSecond: new RateMetric(),
		resendRangeQueriesPerSecond: new RateMetric(),
	};
	metricsContext.addMetrics('broker.plugin.storageProxy', metrics);
	return {
		path: `/streams/:id/data/partitions/:partition/:resendType`,
		method: 'get',
		requestHandlers: [createHandler(logStoreClient, metrics)],
	};
};
