import { LogStoreClient } from '@logsn/client';
import { Logger } from '@streamr/utils';
import { defer, EMPTY, filter, interval, map, shareReplay, tap } from 'rxjs';
import { switchMap } from 'rxjs/internal/operators/switchMap';
import StreamrClient from 'streamr-client';

import { NetworkModeConfig } from '../../../../Plugin';

const logger = new Logger(module);

/**
 * Reports if the node is configured to include only specific streams, but also has an HTTP server enabled.
 * This is not acceptable as it may produce undesired 404 responses from clients.
 *
 * However, this should not shutdown the node, as it's not a critical issue for its operation.
 */
export const createIncompatibleNodeUrlLogger = (
	logStoreClient: LogStoreClient,
	streamrClient: StreamrClient,
	config: NetworkModeConfig
) => {
	const address$ = defer(() => streamrClient.getAddress()).pipe(
		// won't change, we cache it
		shareReplay(1)
	);
	const hasNodeUrl$ = address$.pipe(
		map((nodeAddress) => logStoreClient.getNodeUrl(nodeAddress))
	);

	const hasIncludeOnly =
		config.includeOnly !== undefined && config.includeOnly.length > 0;

	if (!hasIncludeOnly) {
		// this config is static, won't change, so we can already return it
		return EMPTY;
	}

	// run periodically
	return interval(5 * 60 * 1000).pipe(
		switchMap(() => hasNodeUrl$),
		filter(Boolean),
		tap(() => {
			logger.error(
				`This node is configured to include only specific streams, but also has an HTTP server enabled. This may produce undesired 404 responses from clients.`
			);
		})
	);
};
