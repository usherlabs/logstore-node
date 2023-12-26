import { LogStoreClient, Stream } from '@logsn/client';

import { ObservableEventEmitter } from '../../utils/events';


export class NodeStreamsRegistry extends ObservableEventEmitter<{
	registerStream: (stream: Stream) => void;
	unregisterStream: (stream: Stream) => void;
}> {
	private registeredStreams = new Map<string, Stream>();

	constructor(private readonly logStoreClient: LogStoreClient) {
		super();
	}

	public getRegisteredStreams() {
		return Array.from( this.registeredStreams.values() );
	}

	public async registerStreamId(streamId: string) {
		if (this.registeredStreams.has(streamId)) {
			return;
		}
		const stream = await this.logStoreClient.getStream(streamId);
		this.registeredStreams.set(streamId, stream);

		this.emit('registerStream', stream);
	}

	public async unregisterStreamId(streamId: string) {
		const stream = this.registeredStreams.get(streamId);
		if (!stream) {
			return;
		}
		this.registeredStreams.delete(streamId);


		this.emit('unregisterStream', stream);
	}
}
