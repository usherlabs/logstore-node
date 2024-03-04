import type { LogStoreClient } from '@logsn/client';
import { auditTime, map, mergeMap, Subscription } from 'rxjs';
import { EthereumAddress } from 'streamr-client';

const THRESHOLD = 60 * 1000;
export interface NodeHeartbeat {
	latency: number;
	publishDate: Date;
	nodeAddress: EthereumAddress;
	url: string | null;
}

/**
 * It's a readonly version of the Heartbeat. This class makes available information from the
 * network by listening to the heartbeat stream.
 */
export class HeartbeatMonitor {
	// It's ordered by latency
	nodeHeartbeats: NodeHeartbeat[] = [];
	private heartbeatInfoSubscription: Subscription | undefined;

	constructor(protected readonly logStoreClient: LogStoreClient) {}

	public async start(clientId: EthereumAddress) {
		this.heartbeatInfoSubscription =
			this.logStoreClient.nodesHeartbeatInformationListObservable
				.pipe(
					// throttled to avoid frequent reprocessing on single message updates
					auditTime(500), // in milliseconds
					map((list) =>
						// filter out this client itself
						list.filter(({ nodeAddress }) => nodeAddress !== clientId)
					),
					// We know it's already sorted by latency, but to avoid the risk of
					// the client being modified in the future, we sort it again here
					// to ensure the order is correct
					map((list) => list.sort((a, b) => a.latency - b.latency)),
					// include the node url
					// the node URL reference is cached by the LogStoreClient
					// no performance issues here
					mergeMap(async (list) => {
						return Promise.all(
							list.map(async (info) => {
								const url = await this.logStoreClient.getNodeUrl(
									info.nodeAddress
								);
								return {
									...info,
									url,
								};
							})
						);
					})
				)
				.subscribe((list) => {
					this.nodeHeartbeats = list;
				});
	}

	public async stop() {
		this.heartbeatInfoSubscription?.unsubscribe();
	}

	public get onlineNodes(): EthereumAddress[] {
		return this.onlineNodesInfo.map(({ nodeAddress }) => nodeAddress);
	}

	public get onlineNodesInfo() {
		return this.nodeHeartbeats.filter(
			({ publishDate }) => Date.now() - publishDate.getTime() <= THRESHOLD
		);
	}
}
