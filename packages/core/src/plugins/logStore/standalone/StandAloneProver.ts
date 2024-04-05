import assert from 'assert';
import axios from 'axios';
import { sha256, verifyMessage } from 'ethers/lib/utils';

import { BroadbandPublisher } from '../../../shared/BroadbandPublisher';
import { NodeHeartbeat } from '../HeartbeatMonitor';
import { TlsProof } from '../protobuf/generated/prover';
import { Prover } from '../Prover';
import { DEFAULT_PROCESS } from './sink';

const OVERRIDE_NOTARY_URL = process.env.NOTARY_URL;

export class StandAloneProver extends Prover {
	public notaryURL = '';

	async start(nodeHeartbeat: NodeHeartbeat) {
		this.notaryURL = String(nodeHeartbeat.url);
		super.run();
	}

	async verifyProof(notaryURL: string, pubKey: string, proof: string) {
		const { data: notaryVerificationResponse } = await axios.post(
			`${notaryURL}/verify`,
			{
				pubKey,
				data: proof,
			}
		);
		const {
			data: { httpPayload, messageHash, signature, address },
			error,
		} = notaryVerificationResponse as {
			data: {
				httpPayload: string;
				signature: string;
				messageHash: string;
				address: string;
			};
			error: string;
		};

		if (error) throw new Error(error);
		// generate a hash
		const generatedHash = sha256(Buffer.from(httpPayload, 'utf-8'));
		assert(generatedHash === messageHash, 'invalid message hash');

		const recoveredAddress = verifyMessage(generatedHash, signature);
		assert(
			recoveredAddress.toLowerCase() === address.toLocaleLowerCase(),
			'invalid signature '
		);

		return {
			signature,
			messageHash,
			node: address,
		};
	}

	async handleNewProof(proof: TlsProof) {
		const { notaryURL } = this;
		const overrideURL = String(OVERRIDE_NOTARY_URL);

		if (!notaryURL) throw Error('Prover not started');
		this.logger.info(`A new proof with id: ${proof.id} has been receieved`);

		try {
			const { stream: streamId, data } = proof;

			const { data: pk } = await axios.get(`${overrideURL}/notarypub`);
			const notaryPublicKey = pk.data;

			if (!notaryPublicKey) throw Error('Notary public key not found');

			const reqResHash = await this.verifyProof(
				overrideURL,
				notaryPublicKey,
				data
			);

			const streamrStream = await this.streamrClient.getStream(streamId);
			const publisher = new BroadbandPublisher(
				this.streamrClient,
				streamrStream
			);

			await publisher.publish({
				...reqResHash,
				process: proof.process || DEFAULT_PROCESS,
			});
		} catch (e) {
			this.logger.error(`Failed to publish proof over stream`, {
				errorMessage: e.message,
			});
		}
	}
}
