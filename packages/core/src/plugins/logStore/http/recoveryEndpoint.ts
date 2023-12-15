import { Stream } from '@logsn/client';
import { RecoveryRequest } from '@logsn/protocol';
import { Logger, MetricsContext, RateMetric } from '@streamr/utils';
import express, { Request, RequestHandler, Response } from 'express';

import { HttpServerEndpoint } from '../../../Plugin';
import { createBasicAuthenticatorMiddleware } from './authentication';
import { Heartbeat } from '../network/Heartbeat';

const logger = new Logger(module);

const createHandler = (
	systemStream: Stream,
	heartbeat: Heartbeat
): RequestHandler => {
	return async (req: Request, res: Response) => {
		const { requestId, from, to } = req.body;

		const recoveryRequest = new RecoveryRequest({
			requestId,
			from,
			to,
		});
		await systemStream.publish(recoveryRequest.serialize());
		logger.debug(
			'Published RecoveryRequest: %s',
			JSON.stringify(recoveryRequest)
		);

		res.json(heartbeat.onlineNodes);
	};
};

export const createRecoveryEndpoint = (
	systemStream: Stream,
	heartbeat: Heartbeat,
	metricsContext: MetricsContext
): HttpServerEndpoint => {
	const metrics = {
		recoveryRequestsPerSecond: new RateMetric(),
	};
	metricsContext.addMetrics('broker.plugin.logstore', metrics);
	return {
		path: `/recovery`,
		method: 'post',
		requestHandlers: [
			express.json(),
			createBasicAuthenticatorMiddleware(),
			createHandler(systemStream, heartbeat),
		],
	};
};
