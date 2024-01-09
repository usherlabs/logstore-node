import { EthereumAddress, MessageMetadata } from 'streamr-client';

import { BroadbandPublisher } from '../../../shared/BroadbandPublisher';
import { BroadbandSubscriber } from '../../../shared/BroadbandSubscriber';

const INTERVAL = 1 * 1000;
const THRESHOLD = 60 * 1000;

export class Heartbeat {
	private clientId?: EthereumAddress;
	private nodes: Map<EthereumAddress, number>;
	private timer?: NodeJS.Timer;

	constructor(
		private readonly publisher: BroadbandPublisher,
		private readonly subscriber: BroadbandSubscriber
	) {
		this.nodes = new Map();
	}

	public async start(clientId: EthereumAddress) {
		this.clientId = clientId;
		await this.subscriber.subscribe(this.onMessage.bind(this));
		this.timer = setInterval(this.onInterval.bind(this), INTERVAL);
	}

	public async stop() {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		await this.subscriber.unsubscribe();
	}

	public get onlineNodes() {
		const result: EthereumAddress[] = [];
		for (const [node, timestamp] of this.nodes) {
			if (Date.now() - timestamp <= THRESHOLD) {
				result.push(node);
			}
		}

		return result;
	}

	private async onInterval() {
		await this.publisher.publish('');
	}

	private async onMessage(_: unknown, metadata: MessageMetadata) {
		if (metadata.publisherId === this.clientId) {
			return;
		}

		this.nodes.set(metadata.publisherId, metadata.timestamp);
	}
}
