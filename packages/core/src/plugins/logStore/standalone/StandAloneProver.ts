import { BroadbandPublisher } from '../../../shared/BroadbandPublisher';
import { TlsProof } from '../protobuff/generated/prover';
import { Prover } from '../Prover';

export class StandAloneProver extends Prover {
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
