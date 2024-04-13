import type { LogStoreClient } from '@logsn/client';
import { EthereumAddress } from 'streamr-client';

import { BroadbandPublisher } from '../../../shared/BroadbandPublisher';
import { HeartbeatMonitor } from '../HeartbeatMonitor';

const INTERVAL = 1 * 1000;

/**
 * Extends the HeartbeatMonitor to publish the node metadata to other nodes.
 */
export class Heartbeat extends HeartbeatMonitor {
	private timer?: NodeJS.Timer;

	constructor(
		override readonly logStoreClient: LogStoreClient,
		private readonly publisher: BroadbandPublisher
	) {
		super(logStoreClient);
	}

	public override async start(clientId: EthereumAddress) {
		await super.start(clientId);

		this.timer = setInterval(this.onInterval.bind(this), INTERVAL);
	}

	public override async stop() {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		await super.stop();
	}

	private async onInterval() {
		await this.publisher.publish('');
	}
}
