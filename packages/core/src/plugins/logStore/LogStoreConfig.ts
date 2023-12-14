import { StreamPartID } from '@streamr/protocol';
import { Logger } from '@streamr/utils';

const logger = new Logger(module);

export interface LogStoreConfigListener {
	onStreamPartAdded: (streamPart: StreamPartID) => void;
	onStreamPartRemoved: (streamPart: StreamPartID) => void;
}

export interface LogStoreConfig {
	hasStreamPart(streamPart: StreamPartID): boolean;

	getStreamParts(): ReadonlySet<StreamPartID>;

	destroy(): Promise<void>;
}
