import { StreamMessage, StreamMessageType } from '@streamr/protocol';
import StreamrClient from 'streamr-client';

import { ObservableEventEmitter } from '../../utils/events';
import { LogStore } from './LogStore';
import { LogStoreConfig } from './LogStoreConfig';

/**
 * Represents a message listener for storing messages in a log store.
 */
export class MessageListener extends ObservableEventEmitter<{
	message: (msg: StreamMessage) => void;
}> {
	private logStore?: LogStore;
	private logStoreConfig?: LogStoreConfig;

	private cleanupTimer?: NodeJS.Timer;

	constructor(private readonly streamrClient: StreamrClient) {
		super();
	}

	public async start(logStore: LogStore, logStoreConfig: LogStoreConfig) {
		this.logStore = logStore;
		this.logStoreConfig = logStoreConfig;

		const node = await this.streamrClient.getNode();
		// Subscribe to all stream partitions at logstore registry
		node.addMessageListener(this.onStreamMessage.bind(this));
	}

	public async stop() {
		clearInterval(this.cleanupTimer);
		const node = await this.streamrClient.getNode();
		this.removeAllListeners();
		node.removeMessageListener(this.onStreamMessage);
		this.logStoreConfig?.getStreamParts().forEach((streamPart) => {
			node.unsubscribe(streamPart);
		});
	}

	private isStorableMessage(msg: StreamMessage): boolean {
		return msg.messageType === StreamMessageType.MESSAGE;
	}

	private async onStreamMessage(msg: StreamMessage) {
		if (
			this.isStorableMessage(msg) &&
			this.logStoreConfig!.hasStreamPart(msg.getStreamPartID())
		) {
			await this.logStore!.store(msg);
			this.emit('message', msg);
		}
	}
}
