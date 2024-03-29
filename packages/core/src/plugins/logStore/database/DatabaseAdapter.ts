import { MessageID, StreamMessage } from '@streamr/protocol';
import { Logger } from '@streamr/utils';
import { Readable } from 'stream';

import { ObservableEventEmitter } from '../../../utils/events';

const logger = new Logger(module);

export const DatabaseEventEmitter = ObservableEventEmitter<{
	read: (streamMessage: StreamMessage) => void;
	write: (streamMessage: StreamMessage) => void;
}>;

// NET-329
export type QueryDebugInfo =
	| {
			streamId: string;
			partition?: number;
			limit?: number;
			fromTimestamp?: number;
			toTimestamp?: number;
			fromSequenceNo?: number | null;
			toSequenceNo?: number | null;
			publisherId?: string | null;
			msgChainId?: string | null;
	  }
	| {
			messageIds: string[];
	  };

export abstract class DatabaseAdapter extends DatabaseEventEmitter {
	constructor() {
		super();
	}

	abstract queryRange(
		streamId: string,
		partition: number,
		fromTimestamp: number,
		fromSequenceNo: number,
		toTimestamp: number,
		toSequenceNo: number,
		publisherId?: string,
		msgChainId?: string,
		limit?: number
	): Readable;

	abstract queryByMessageIds(messageIds: MessageID[]): Readable;

	abstract queryLast(
		streamId: string,
		partition: number,
		requestCount: number
	): Readable;

	abstract getFirstMessageDateInStream(
		streamId: string,
		partition: number
	): Promise<number | null>;

	abstract getLastMessageDateInStream(
		streamId: string,
		partition: number
	): Promise<number | null>;

	abstract getNumberOfMessagesInStream(
		streamId: string,
		partition: number
	): Promise<number>;

	abstract getTotalBytesInStream(
		streamId: string,
		partition: number
	): Promise<number>;

	protected parseRow(debugInfo: QueryDebugInfo) {
		return (row: {
			payload: Buffer | string | null | any[] | unknown;
		}): StreamMessage | null => {
			if (row.payload == null) {
				logger.error(
					`Found message with NULL payload on cassandra; debug info: ${JSON.stringify(
						debugInfo
					)}`
				);
				return null;
			}

			const serializedPayload = Array.isArray(row.payload)
				? row.payload
				: row.payload.toString();

			const streamMessage = StreamMessage.deserialize(serializedPayload);
			this.emit('read', streamMessage);
			return streamMessage;
		};
	}

	abstract store(streamMessage: StreamMessage): Promise<boolean>;

	abstract start(): Promise<void>;

	abstract stop(): Promise<void>;
}
