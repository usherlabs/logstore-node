import { MessageRef, StreamMessage } from '@streamr/protocol';
import { Logger, ObservableEventEmitter } from '@streamr/utils';
import { Readable } from 'stream';

const logger = new Logger(module);

export const DatabaseEventEmitter = ObservableEventEmitter<{
	read: (streamMessage: Uint8Array) => void;
	write: (streamMessage: Uint8Array) => void;
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
			streamId: string;
			partition?: number;
			messageRefs: MessageRef[];
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

	abstract queryByMessageRefs(
		streamId: string,
		partition: number,
		messageRefs: MessageRef[]
	): Readable;

	abstract queryFirst(
		streamId: string,
		partition: number,
		requestCount: number
	): Readable;

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
		return (row: Record<string, any>): Uint8Array | null => {
			if (row.payload === null) {
				logger.error('Found unexpected message with NULL payload in database', {
					debugInfo,
				});
				return null;
			}

			this.emit('read', row.payload);
			return row.payload;
		};
	}

	abstract store(streamMessage: StreamMessage): Promise<boolean>;

	abstract start(): Promise<void>;

	abstract stop(): Promise<void>;
}
