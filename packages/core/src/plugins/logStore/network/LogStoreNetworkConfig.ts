import { LogStoreClient } from '@logsn/client';
import { StreamPartID } from '@streamr/protocol';
import StreamrClient, { Stream } from '@streamr/sdk';
import { keyToArrayIndex, Logger } from '@streamr/utils';

import {
	Diff,
	SetMembershipSynchronizer,
} from '../../../utils/SetMembershipSynchronizer';
import { LogStoreConfig, LogStoreConfigListener } from '../LogStoreConfig';
import { LogStoreEventListener } from '../LogStoreEventListener';
import { LogStorePoller } from './LogStorePoller';

const logger = new Logger(module);

/**
 * Manages the two data sources for LogStore node assignments (poll-based and
 * event-based), feeding the received full state and partial state updates to
 * `SetMembershipSynchronizer`. The state diffs produced by the
 * synchronizer are then further delivered to the user of this class via
 * listeners.
 *
 * The two data sources, heterogeneous in nature, are:
 *
 *  (1) Poll-based LogStore node assignments occurring on a scheduled interval
 *      (reliable, large payload, infrequent, may be stale)
 *
 *  (2) Event-based LogStore node assignments picked up in real-time
 *      (intermittent, small payload, frequent, up-to-date)
 *
 *  Event-based assignments are great for picking up on changes quickly.
 *  However, there is a risk of not receiving updates due to, e.g. connectivity
 *  issues. Therefore, if the real-time system fails, polling acts as a sort-of
 *  backup system.
 */
export class LogStoreNetworkConfig implements LogStoreConfig {
	private readonly listener: LogStoreConfigListener;
	private readonly synchronizer = new SetMembershipSynchronizer<StreamPartID>();
	private readonly clusterSize: number;
	private readonly myIndexInCluster: number;
	private readonly logStorePoller: LogStorePoller;
	private readonly logStoreEventListener: LogStoreEventListener;
	private readonly abortController: AbortController;

	constructor(
		clusterSize: number,
		myIndexInCluster: number,
		pollInterval: number,
		logStoreClient: LogStoreClient,
		streamrClient: StreamrClient,
		listener: LogStoreConfigListener
	) {
		this.clusterSize = clusterSize;
		this.myIndexInCluster = myIndexInCluster;
		this.listener = listener;
		this.logStorePoller = new LogStorePoller(
			pollInterval,
			logStoreClient,
			(streams, block) => {
				const streamParts = streams.flatMap((stream: Stream) => [
					...this.createMyStreamParts(stream),
				]);
				this.handleDiff(
					this.synchronizer.ingestSnapshot(
						new Set<StreamPartID>(streamParts),
						block
					)
				);
			}
		);
		this.logStoreEventListener = new LogStoreEventListener(
			logStoreClient,
			streamrClient,
			(stream, type, block) => {
				const streamParts = this.createMyStreamParts(stream);
				this.handleDiff(
					this.synchronizer.ingestPatch(streamParts, type, block)
				);
			}
		);
		this.abortController = new AbortController();
	}

	async start(): Promise<void> {
		await Promise.all([
			this.logStorePoller.start(this.abortController.signal),
			this.logStoreEventListener.start(),
		]);
	}

	async destroy(): Promise<void> {
		this.abortController.abort();
		await this.logStoreEventListener.destroy();
	}

	hasStreamPart(streamPart: StreamPartID): boolean {
		return this.getStreamParts().has(streamPart);
	}

	getStreamParts(): ReadonlySet<StreamPartID> {
		return this.synchronizer.getState();
	}

	private createMyStreamParts(stream: Stream): Set<StreamPartID> {
		return new Set<StreamPartID>(
			stream.getStreamParts().filter((streamPart) => {
				const hashedIndex = keyToArrayIndex(this.clusterSize, streamPart);
				return hashedIndex === this.myIndexInCluster;
			})
		);
	}

	private handleDiff({ added, removed }: Diff<StreamPartID>): void {
		added.forEach((streamPart) => this.listener.onStreamPartAdded(streamPart));
		removed.forEach((streamPart) =>
			this.listener.onStreamPartRemoved(streamPart)
		);
		logger.info('Updated state', {
			added,
			removed,
		});
	}
}
