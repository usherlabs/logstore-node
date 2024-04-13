import assert from 'assert';
import axios from 'axios';
import { sha256, verifyMessage } from 'ethers/lib/utils';
import StreamrClient from 'streamr-client';

import { BroadbandPublisher } from '../../../shared/BroadbandPublisher';
import { NodeHeartbeat } from '../HeartbeatMonitor';
import { TlsProof } from '../protobuf/generated/prover';
import { Prover } from '../Prover';
import { DEFAULT_PROCESS } from './sink';

const OVERRIDE_NOTARY_URL = process.env.NOTARY_URL;

export class StandaloneProver extends Prover {
	public notaryURL = '';

	constructor(
		socketPath: string,
		streamrClient: StreamrClient,
		private withSink = false
	) {
		super(socketPath, streamrClient);
	}

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

	// Here we are automating verification of TLS Proofs against a Notary Network Node as soon as TLS Proof Generation is complete.
	async handleNewProofWithSink(proof: TlsProof) {
		let { notaryURL } = this;
		const overrideURL = String(OVERRIDE_NOTARY_URL);
		if (overrideURL) {
			notaryURL = overrideURL;
		}

		if (!notaryURL) throw Error('Prover not started');
		this.logger.info(`A new proof with id: ${proof.id} has been receieved`);

		try {
			const { stream: streamId, data } = proof;

			// ! For now, the selected Notary for verification will be the same Notary used to generate the Proof. In the future this will not be the case.
			const { data: pk } = await axios.get(`${notaryURL}/notarypub`);
			const notaryPublicKey = pk.data;

			if (!notaryPublicKey) throw Error('Notary public key not found');

			const reqResHash = await this.verifyProof(
				notaryURL,
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

	// As per https://github.com/usherlabs/logstore-node/blob/feature/t-node/packages/core/src/plugins/logStore/standalone/StandAloneProver.ts#L5
	async handleNewProof(proof: TlsProof) {
		if (this.withSink) {
			return this.handleNewProofWithSink(proof);
		}

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
