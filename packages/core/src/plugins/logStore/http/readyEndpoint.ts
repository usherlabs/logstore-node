import { toStreamID, toStreamPartID } from '@streamr/protocol';
import { Request, RequestHandler, Response } from 'express';
import {
	catchError,
	defer,
	filter,
	firstValueFrom,
	interval,
	map,
	of,
	timeout,
} from 'rxjs';
import { switchMap } from 'rxjs/internal/operators/switchMap';

import { HttpServerEndpoint } from '../../../Plugin';
import { logStoreContext } from '../context';
import { sendError } from './httpHelpers';
import { injectLogstoreContextMiddleware } from './injectLogstoreContextMiddleware';

/*
 * Ready Endpoint
 *
 * Used to define if a stream-partition is ready to receive data from any of its neighbors
 * It will return false if the stream-partition has no neighbors. E.g. there's no active node publishing to it.
 *
 * It was created to help an oracle knowing if the log store node is already receiving real time data for a stream.
 * But even if the node is not `ready`, this node may still contain data about the stream for an older period.
 *
 * Path: /stores/:id/partitions/:partition/ready
 * Query parameters:
 * - timeout: in milliseconds (30000 by default). If the node is not ready in this time, it will return false.
 */

const createHandler = (): RequestHandler => {
	return async (req: Request, res: Response) => {
		// Parse path parameters
		if (Number.isNaN(parseInt(req.params.partition))) {
			sendError(
				`Path parameter "partition" not a number: ${req.params.partition}`,
				res
			);
			return;
		}

		const streamId = req.params.id;
		if (!streamId) {
			sendError(`Missing path parameter "id"`, res);
			return;
		}
		const partition = parseInt(req.params.partition);

		// Parse query parameters
		const timeoutVal = parseInt((req.query.timeout as string) ?? '30000');
		if (Number.isNaN(timeoutVal)) {
			sendError(
				`Query parameter "timeout" not a number: ${req.query.timeout}`,
				res
			);
			return;
		}

		// get store from context, so we can use the already used streamr client
		const store = logStoreContext.getStore();
		if (!store) {
			throw new Error('LogStore context was not initialized');
		}
		const { logStorePlugin } = store;


		try {
			const streamPartID = toStreamPartID(toStreamID(streamId), partition);
			const node = await logStorePlugin.streamrClient.getNode();
			const hasNeighboors$ = defer(async () => node.getNeighbors(streamPartID)).pipe(
				map((neighbors) => neighbors.length > 0)
			);

			// Each 500 ms check if the stream-partition has neighbors
			// emit an event only if it has
			const ready$ = interval(500).pipe(
				switchMap(() => hasNeighboors$),
				filter(Boolean)
			);

			// define the timeout after subscribing
			// if timeout or any other error occurs, return false
			const response$ = ready$.pipe(
				map(() => ({ ready: true })),
				timeout(timeoutVal),
				catchError((err) => of({ ready: false }))
			);

			// wait for the response and return it
			const response = await firstValueFrom(response$);
			res.json(response);
		} catch (error) {
			sendError(error, res);
		}
	};
};

export const createReadyEndpoint = (): HttpServerEndpoint => {
	const ctx = logStoreContext.getStore();

	return {
		path: `/stores/:id/partitions/:partition/ready`,
		method: 'get',
		requestHandlers: [
			// We need to inject it here, because the execution context from
			// below is usually created after the endpoint is created.
			injectLogstoreContextMiddleware(ctx),
			createHandler(),
		],
	};
};
