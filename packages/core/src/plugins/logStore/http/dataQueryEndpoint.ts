/**
 * Endpoints for RESTful data requests
 */
import { MetricsContext, MetricsDefinition, RateMetric } from '@streamr/utils';
import { Request, RequestHandler, Response } from 'express';

import { HttpServerEndpoint } from '../../../Plugin';
import { LogStoreContext, logStoreContext } from '../context';
import { createBasicAuthenticatorMiddleware } from './authentication';
import { getFormat } from './DataQueryFormat';
import { getForFromQueryRequest } from './getDataForRequest/getForFromQueryRequest';
import { getForLastQueryRequest } from './getDataForRequest/getForLastQueryRequest';
import { getForRangeQueryRequest } from './getDataForRequest/getForRangeQueryRequest';
import { sendError, sendSuccess } from './httpHelpers';
import { FromRequest, LastRequest, RangeRequest } from './requestTypes';

// TODO: move this to protocol-js
export const MIN_SEQUENCE_NUMBER_VALUE = 0;
export const MAX_SEQUENCE_NUMBER_VALUE = 2147483647;

export function parseIntIfExists(x: string | undefined): number | undefined {
	return x === undefined ? undefined : parseInt(x);
}

/**
 * Determines the type of request based on the provided parameter.
 * Intention here is to befriend with TypeScript and make sure that the request
 * type is known at compile time.
 */
const getRequestType = (
	req: LastRequest | FromRequest | RangeRequest
):
	| { type: 'last'; req: LastRequest }
	| { type: 'from'; req: FromRequest }
	| { type: 'range'; req: RangeRequest } => {
	if (req.params.queryType === 'last') {
		return { type: 'last', req: req as LastRequest };
	} else if (req.params.queryType === 'from') {
		return { type: 'from', req: req as FromRequest };
	} else if (req.params.queryType === 'range') {
		return { type: 'range', req: req as RangeRequest };
	} else {
		throw new Error(`Unknown query type: ${req.params.queryType}`);
	}
};

const getDataForRequest = async (
	arg: Parameters<
		| typeof getForLastQueryRequest
		| typeof getForFromQueryRequest
		| typeof getForRangeQueryRequest
	>[0],
	{ res }: { res: Response }
) => {
	const { req, ...rest } = arg;
	const reqType = getRequestType(req);
	let queryRequestBag;
	switch (reqType.type) {
		case 'last': {
			queryRequestBag = getForLastQueryRequest({ req: reqType.req, ...rest });
			break;
		}
		case 'from': {
			queryRequestBag = getForFromQueryRequest({ req: reqType.req, ...rest });
			break;
		}
		case 'range': {
			queryRequestBag = getForRangeQueryRequest({ req: reqType.req, ...rest });
			break;
		}
		default:
			throw new Error(`Unknown query type: ${reqType}`);
	}

	if ('error' in queryRequestBag) {
		sendError(queryRequestBag.error?.message, res);
		return;
	} else {
		const store = logStoreContext.getStore();
		if (!store) {
			throw new Error('Used store before it was initialized');
		}

		const { data, participatingNodes } =
			await store.logStorePlugin.processQueryRequest(
				queryRequestBag.queryRequest
			);

		return {
			data,
			requestId: queryRequestBag.queryRequest.requestId,
			participatingNodes,
		};
	}
};

const createHandler = (metrics: MetricsDefinition): RequestHandler => {
	return async (req: Request, res: Response) => {
		if (Number.isNaN(parseInt(req.params.partition))) {
			sendError(
				`Path parameter "partition" not a number: ${req.params.partition}`,
				res
			);
			return;
		}

		const format = getFormat(req.query.format as string | undefined);

		const store = logStoreContext.getStore();
		if (!store) {
			throw new Error('LogStore context was not initialized');
		}

		const { logStorePlugin } = store;

		const validation = await logStorePlugin.validateQueryRequest(req);
		if (!validation.valid) {
			sendError(validation.message, res, validation.errorCode);
			return;
		}

		const streamId = req.params.id;
		const partition = parseInt(req.params.partition);
		const version = parseIntIfExists(req.query.version as string);
		try {
			const response = await getDataForRequest(
				{
					req,
					streamId,
					partition,
					metrics,
				},
				{
					res,
				}
			);
			if (response) {
				sendSuccess(
					response.data,
					format,
					version,
					streamId,
					response.requestId,
					response.participatingNodes,
					req,
					res
				);
			}
		} catch (error) {
			sendError(error, res);
		}
	};
};

function injectLogstoreContextMiddleware(
	ctx: LogStoreContext | undefined
): RequestHandler {
	return (_req, _res, next) => {
		ctx ? logStoreContext.run(ctx, () => next()) : () => next();
	};
}

export const createDataQueryEndpoint = (
	metricsContext: MetricsContext
): HttpServerEndpoint => {
	const ctx = logStoreContext.getStore();
	const metrics = {
		resendLastQueriesPerSecond: new RateMetric(),
		resendFromQueriesPerSecond: new RateMetric(),
		resendRangeQueriesPerSecond: new RateMetric(),
	};
	metricsContext.addMetrics('broker.plugin.logstore', metrics);
	return {
		path: `/stores/:id/data/partitions/:partition/:queryType`,
		method: 'get',
		requestHandlers: [
			// We need to inject it here, because the execution context from
			// below is usually created after the endpoint is created.
			injectLogstoreContextMiddleware(ctx),
			createBasicAuthenticatorMiddleware(),
			createHandler(metrics),
		],
	};
};
