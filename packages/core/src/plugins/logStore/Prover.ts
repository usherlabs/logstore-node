import { Logger } from '@streamr/utils';
import { ZMQClientTransport } from '@usherlabs/protobuf-zmq-ts-transport';
import StreamrClient from 'streamr-client';
import * as zmq from 'zeromq';

import { TlsProof } from './protobuff/generated/prover';
import { SocketClient } from './protobuff/generated/prover.client';

// TODO extract these to global configs and global constants
export type NetworkType = 'network' | 'standalone';
export const proverSocketPath = `ipc:///tmp/test_sockets/test_pub`;

export abstract class Prover {
	logger: Logger;
	subscription;
	socketConnectionURL: string;
	subscriber: zmq.Subscriber;
	socketClient: SocketClient;
	streamrClient: StreamrClient;

	constructor(socketPath: string, streamrClient: StreamrClient) {
		const dealer = new zmq.Dealer();
		this.subscriber = new zmq.Subscriber();

		this.subscriber.connect(socketPath);
		this.streamrClient = streamrClient;

		const zmqTransportClient = new ZMQClientTransport(this.subscriber, dealer);
		this.subscription = zmqTransportClient.start();

		this.socketClient = new SocketClient(zmqTransportClient);
		this.socketConnectionURL = socketPath;
		this.logger = new Logger(module);
	}

	abstract handleNewProof(proof: TlsProof): void;

	start() {
		const proofSubscription = this.socketClient.subscribeToProofs({});
		proofSubscription.responses.onNext(
			(proof: undefined | TlsProof) => proof && this.handleNewProof(proof)
		);
	}

	stop() {
		this.subscription.unsubscribe();
		this.subscriber.disconnect(this.socketConnectionURL);
	}
}
