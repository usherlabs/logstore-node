import {StreamPartID} from '@streamr/protocol';

import {LogStoreConfig, LogStoreConfigListener} from '../LogStoreConfig';


export class LogStoreStandaloneConfig implements LogStoreConfig {
	private readonly streamParts: Set<StreamPartID>;

	constructor(
		trackedStreams: StreamPartID[],
		listener: LogStoreConfigListener
	) {
		this.streamParts = new Set<StreamPartID>(trackedStreams);
		// done as above just to permit it to evolve to dynamically add streams and better consistency
		this.streamParts.forEach(listener.onStreamPartAdded);
	}

	hasStreamPart(streamPart: StreamPartID): boolean {
		return this.streamParts.has(streamPart);
	}

	getStreamParts(): ReadonlySet<StreamPartID> {
		return this.streamParts;
	}

	async destroy(): Promise<void> {
	}
}
