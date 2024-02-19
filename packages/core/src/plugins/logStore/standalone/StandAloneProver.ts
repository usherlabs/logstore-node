import StreamrClient from 'streamr-client';

import { BroadbandPublisher } from '../../../shared/BroadbandPublisher';
import { TlsProof } from '../protobuff/generated/prover';
import { Prover } from '../Prover';

export class StandAloneProver extends Prover {
	streamrClient: StreamrClient;

	constructor(socketPath: string, streamrClient: StreamrClient) {
		super(socketPath);
		this.streamrClient = streamrClient;
	}

	async start() {
		super.start(this.streamrClient);
	}

	async handleNewProof(proof: TlsProof) {
		this.logger.info(`A new proof with id: ${proof.id} has been receieved`);
		try {
			const { stream: streamId } = proof;
			const streamrStream = await this.streamrClient.getStream(streamId);

			const publisher = new BroadbandPublisher(
				this.streamrClient,
				streamrStream
			);
			await publisher.publish(proof);
		} catch (e) {
			this.logger.error(`Failed to publish proof over stream`, {
				errorMessage: e.message,
			});
		}
	}
}
