import { LogStoreClient } from '@logsn/client';
import { Logger, scheduleAtInterval } from '@streamr/utils';
import { Stream } from 'streamr-client';

const logger = new Logger(module);

/**
 * Polls full state of LogStore on an interval.
 */
export class LogStorePoller {
	private readonly pollInterval: number;
	private readonly logStoreClient: LogStoreClient;
	private readonly onNewSnapshot: (streams: Stream[], block: number) => void;

	constructor(
		pollInterval: number,
		logStoreClient: LogStoreClient,
		onNewSnapshot: (streams: Stream[], block: number) => void
	) {
		this.pollInterval = pollInterval;
		this.logStoreClient = logStoreClient;
		this.onNewSnapshot = onNewSnapshot;
	}

	async start(abortSignal: AbortSignal): Promise<void> {
		if (this.pollInterval > 0) {
			await scheduleAtInterval(
				() => this.tryPoll(),
				this.pollInterval,
				true,
				abortSignal
			);
		} else {
			await this.tryPoll();
		}
	}

	async poll(): Promise<void> {
		logger.info('Polling');
		const { streams, blockNumber } =
			await this.logStoreClient.getLogStoreStreams();
		logger.info('Polled', {
			foundStreams: streams.length,
			blockNumber,
		});
		this.onNewSnapshot(streams, blockNumber);
	}

	private async tryPoll(): Promise<void> {
		try {
			await this.poll();
		} catch (err) {
			logger.warn('Failed to poll full state', err);
		}
	}
}
