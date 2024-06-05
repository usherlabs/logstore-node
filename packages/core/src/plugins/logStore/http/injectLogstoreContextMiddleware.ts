import { RequestHandler } from 'express';

import { logStoreContext, LogStoreContext } from '../context';

export function injectLogstoreContextMiddleware(
	ctx: LogStoreContext | undefined
): RequestHandler {
	return (_req, _res, next) => {
		ctx ? logStoreContext.run(ctx, () => next()) : () => next();
	};
}
