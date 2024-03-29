import StreamrClient, { Stream } from '@streamr/sdk';

import { ObservableEventEmitter } from '../../utils/events';

export class NodeStreamsRegistry extends ObservableEventEmitter<{
	registerStream: (stream: Stream) => void;
	unregisterStream: (stream: Stream) => void;
}> {
	private registeredStreams = new Map<string, Stream>();

	constructor(private readonly streamrClient: StreamrClient) {
		super();
	}

	public getRegisteredStreams() {
		return Array.from(this.registeredStreams.values());
	}

	public async registerStreamId(streamId: string) {
		if (this.registeredStreams.has(streamId)) {
			return;
		}
		const stream = await this.streamrClient.getStream(streamId);
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

	public clear() {
		this.registeredStreams.forEach((_, streamId) =>
			this.unregisterStreamId(streamId)
		);
	}
}
