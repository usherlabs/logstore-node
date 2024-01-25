import { EthereumAddress, Logger } from '@streamr/utils';
import { Stream, StreamID, StreamrClient } from 'streamr-client';

import {
	Diff,
	SetMembershipSynchronizer,
} from '../../utils/SetMembershipSynchronizer';
import { StorageEventListener } from './StorageEventListener';
import { StoragePoller } from './StoragePoller';

const logger = new Logger(module);

export interface StorageConfigListener {
	onStreamAdded: (streamPart: StreamID) => void;
	onStreamRemoved: (streamPart: StreamID) => void;
}

/**
 * Manages the two data sources for storage node assignments (poll-based and
 * event-based), feeding the received full state and partial state updates to
 * `StorageAssignmentSynchronizer`. The state diffs produced by the
 * synchronizer are then further delivered to the user of this class via
 * listeners.
 *
 * The two data sources, heterogeneous in nature, are:
 *
 *  (1) Poll-based storage node assignments occurring on a scheduled interval
 *      (reliable, large payload, infrequent, may be stale)
 *
 *  (2) Event-based storage node assignments picked up in real-time
 *      (intermittent, small payload, frequent, up-to-date)
 *
 *  Event-based assignments are great for picking up on changes quickly.
 *  However, there is a risk of not receiving updates due to, e.g. connectivity
 *  issues. Therefore, if the real-time system fails, polling acts as a sort-of
 *  backup system.
 */
export class StorageConfig {
	private readonly listener: StorageConfigListener;
	private readonly synchronizer = new SetMembershipSynchronizer<StreamID>();
	private readonly storagePoller: StoragePoller;
	private readonly storageEventListener: StorageEventListener;
	private readonly abortController: AbortController;

	constructor(
		clusterId: EthereumAddress,
		pollInterval: number,
		streamrClient: StreamrClient,
		listener: StorageConfigListener
	) {
		this.listener = listener;
		this.storagePoller = new StoragePoller(
			clusterId,
			pollInterval,
			streamrClient,
			(streams, block) => {
				const streamIDs = streams.map((stream: Stream) => stream.id);
				this.handleDiff(
					this.synchronizer.ingestSnapshot(new Set<StreamID>(streamIDs), block)
				);
			}
		);
		this.storageEventListener = new StorageEventListener(
			clusterId,
			streamrClient,
			(stream, type, block) => {
				this.handleDiff(
					this.synchronizer.ingestPatch(
						new Set<StreamID>([stream.id]),
						type,
						block
					)
				);
			}
		);
		this.abortController = new AbortController();
	}

	async start(): Promise<void> {
		this.storageEventListener.start();
		await this.storagePoller.start(this.abortController.signal);
	}

	destroy(): void {
		this.abortController.abort();
		this.storageEventListener.destroy();
	}

	hasStream(stream: StreamID): boolean {
		return this.getStreams().has(stream);
	}

	getStreams(): ReadonlySet<StreamID> {
		return this.synchronizer.getState();
	}

	private handleDiff({ added, removed }: Diff<StreamID>): void {
		added.forEach((streamID) => this.listener.onStreamAdded(streamID));
		removed.forEach((streamID) => this.listener.onStreamRemoved(streamID));
		logger.info('Updated state', {
			added,
			removed,
		});
	}
}
