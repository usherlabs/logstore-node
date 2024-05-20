import { QueryRequest, QueryType } from '@logsn/protocol';
import { MessageRef } from '@streamr/protocol';
import { MetricsDefinition } from '@streamr/utils';
import { v4 as uuid } from 'uuid';

import {
	MIN_SEQUENCE_NUMBER_VALUE,
	parseIntIfExists,
} from '../dataQueryEndpoint';
import { getMessageLimitForRequest } from '../messageLimiter';
import { FromRequest } from '../requestTypes';
import { QueryRequestBag } from './common';
import { seqNumQueryRequest } from './seqNumQueryRequestState';

/**
 * Get QueryRequest of 'from' type from the request.
 */
export const getForFromQueryRequest = ({
	req,
	streamId,
	partition,
	metrics,
}: {
	req: FromRequest;
	streamId: string;
	partition: number;
	metrics: MetricsDefinition;
}): QueryRequestBag => {
	metrics.resendFromQueriesPerSecond.record(1);
	const fromTimestamp = parseIntIfExists(req.query.fromTimestamp);
	const fromSequenceNumber =
		parseIntIfExists(req.query.fromSequenceNumber) || MIN_SEQUENCE_NUMBER_VALUE;
	const { publisherId } = req.query;
	if (fromTimestamp === undefined) {
		return {
			error: {
				message: 'Query parameter "fromTimestamp" required.',
			},
		};
	}
	if (Number.isNaN(fromTimestamp)) {
		return {
			error: {
				message: `Query parameter "fromTimestamp" not a number: ${req.query.fromTimestamp}`,
			},
		};
	}

	// Added 1 because we want to know later if there are more events, so we
	// may add a metadata field to the response
	const messageLimitForRequest = getMessageLimitForRequest(req) + 1;
	const limitOrUndefinedIfInfinity = isFinite(messageLimitForRequest)
		? messageLimitForRequest
		: undefined;

	const requestId = uuid();
	const queryRequest = new QueryRequest({
		seqNum: seqNumQueryRequest.getAndIncrement(),
		requestId,
		consumerId: req.consumer!,
		streamId,
		partition,
		queryOptions: {
			queryType: QueryType.From,
			from: new MessageRef(fromTimestamp, fromSequenceNumber),
			limit: limitOrUndefinedIfInfinity,
			publisherId,
		},
	});

	return { queryRequest };
};
