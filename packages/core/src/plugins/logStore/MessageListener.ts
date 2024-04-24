import { StreamMessage, StreamMessageType } from '@streamr/protocol';
import StreamrClient from '@streamr/sdk';
import { ObservableEventEmitter } from '@streamr/utils';

import { LogStore } from './LogStore';
import { LogStoreConfig } from './LogStoreConfig';
import { ValidationSchemaManager } from './validation-schema/ValidationSchemaManager';

/**
 * Represents a message listener for storing messages in a log store.
 */
export class MessageListener extends ObservableEventEmitter<{
	message: (msg: StreamMessage) => void;
}> {
	private logStore?: LogStore;
	private logStoreConfig?: LogStoreConfig;

	private cleanupTimer?: NodeJS.Timer;

	constructor(
		private readonly streamrClient: StreamrClient,
		private readonly validationManager: ValidationSchemaManager
	) {
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
			const validationResult =
				await this.validationManager.validateMessage(msg);

			if (!validationResult.valid) {
				await this.validationManager.publishValidationErrors(
					msg.getStreamId(),
					validationResult.errors
				);
				return;
			}

			await this.logStore!.store(msg);
			this.emit('message', msg);
		}
	}
}
