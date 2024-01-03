import { MessageID, StreamMessage } from '@streamr/protocol';
import { Logger } from '@streamr/utils';
import { Readable, Transform } from 'stream';

import { ObservableEventEmitter } from '../../../utils/events';
import { Bucket } from '../Bucket';

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

export abstract class DatabaseAdapter
	extends DatabaseEventEmitter
	implements DatabaseAdapterInterface
{
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

	abstract queryByMessageIds(messageIds: MessageID[]): Transform;

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

	abstract store(streamMessage: StreamMessage): Promise<boolean>;

	abstract getLastBuckets(
		streamId: string,
		partition: number,
		limit?: number,
		timestamp?: number
	): Promise<Bucket[]>;

	abstract upsertBucket(bucket: Bucket): Promise<{ bucket: Bucket; records: number }>;

	abstract start(): Promise<void>;

	abstract stop(): Promise<void>;
}

export type DatabaseAdapterInterface = {
	queryRange(
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

	queryByMessageIds(messageIds: MessageID[]): Transform;

	queryLast(
		streamId: string,
		partition: number,
		requestCount: number
	): Readable;

	getFirstMessageDateInStream(
		streamId: string,
		partition: number
	): Promise<number | null>;

	getLastMessageDateInStream(
		streamId: string,
		partition: number
	): Promise<number | null>;

	getNumberOfMessagesInStream(
		streamId: string,
		partition: number
	): Promise<number>;

	getTotalBytesInStream(streamId: string, partition: number): Promise<number>;

	store(streamMessage: StreamMessage): Promise<boolean>;

	getLastBuckets(
		streamId: string,
		partition: number,
		limit?: number,
		timestamp?: number
	): Promise<Bucket[]>;

	upsertBucket(bucket: Bucket): Promise<{ bucket: Bucket; records: number }>;

	start(): Promise<void>;

	stop(): Promise<void>;
};
