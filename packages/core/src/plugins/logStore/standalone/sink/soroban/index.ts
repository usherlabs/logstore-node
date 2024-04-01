import {
	BASE_FEE,
	Contract,
	Keypair,
	Memo,
	MemoType,
	nativeToScVal,
	Operation,
	SorobanRpc,
	Transaction,
	TransactionBuilder,
} from '@stellar/stellar-sdk';
import { Logger } from '@streamr/utils';

import { MessagePayload } from './types';
import { transformPayload } from './utils';

export class SorobanContract {
	private contract: Contract;
	private server: SorobanRpc.Server;
	private sourceKeypair: Keypair;
	private network: string;
	private logger: Logger;

	constructor(
		secret: string,
		contract: {
			address: string;
			networkRPC: string;
			network: string;
		}
	) {
		this.sourceKeypair = Keypair.fromSecret(secret);

		// Configure SorobanClient to use the `soroban-rpc` instance of your choosing.
		this.server = new SorobanRpc.Server(contract.networkRPC);
		this.contract = new Contract(contract.address);
		this.network = contract.network;
		this.logger = new Logger(module);
	}

	async buildVerificationTransaction(
		streamrMessages: MessagePayload[],
		processName: string
	) {
		const functionName = 'verify_process';
		const parsedProcessName = nativeToScVal(processName);
		const payload = nativeToScVal(streamrMessages.map(transformPayload));

		// -------------------------------------- build the transaction object
		//
		// Transactions require a valid sequence number (which varies from one
		// account to another). We fetch this sequence number from the RPC server.
		const sourceAccount = await this.server.getAccount(
			this.sourceKeypair.publicKey()
		);

		// The transaction begins as pretty standard. The source account, minimum
		// fee, and network passphrase are provided.
		// networkPassphrase: Networks.TESTNET,
		const builtTransaction = new TransactionBuilder(sourceAccount, {
			fee: BASE_FEE,
			networkPassphrase: this.network,
		})
			// The invocation of the `increment` function of our contract is added
			// to the transaction. Note: `increment` doesn't require any parameters,
			// but many contract functions do. You would need to provide those here.
			.addOperation(
				this.contract.call(functionName, payload, parsedProcessName)
			)
			// This transaction will be valid for the next 30 seconds
			.setTimeout(50)
			.build();

		this.logger.info(
			`builtTransaction=${builtTransaction.toXDR().slice(0, 50)}...`
		);

		// We use the RPC server to "prepare" the transaction. This simulating the
		// transaction, discovering the storage footprint, and updating the
		// transaction to include that footprint. If you know the footprint ahead of
		// time, you could manually use `addFootprint` and skip this step.
		const preparedTransaction = await this.server.prepareTransaction(
			builtTransaction
		);

		// Sign the transaction with the source account's keypair.
		preparedTransaction.sign(this.sourceKeypair);

		// Let's see the base64-encoded XDR of the transaction we just built.
		this.logger.info(
			`Signed prepared transaction XDR: ${preparedTransaction
				.toEnvelope()
				.toXDR('base64')}`
		);

		return preparedTransaction;
	}

	async submitTransaction(
		preparedTransaction: Transaction<Memo<MemoType>, Operation[]>
	) {
		// Submit the transaction to the Soroban-RPC server. The RPC server will
		// then submit the transaction into the network for us. Then we will have to
		// wait, polling `getTransaction` until the transaction completes.

		// Submit the transaction to the Soroban-RPC server. The RPC server will
		// then submit the transaction into the network for us. Then we will have to
		// wait, polling `getTransaction` until the transaction completes.
		try {
			const sendResponse = await this.server.sendTransaction(
				preparedTransaction
			);
			this.logger.info(`Sent transaction: ${JSON.stringify(sendResponse)}`);

			if (sendResponse.status === 'PENDING') {
				let getResponse = await this.server.getTransaction(sendResponse.hash);
				// Poll `getTransaction` until the status is not "NOT_FOUND"
				while (getResponse.status === 'NOT_FOUND') {
					this.logger.info('Waiting for transaction confirmation...');
					// See if the transaction is complete
					getResponse = await this.server.getTransaction(sendResponse.hash);
					// Wait one second
					await new Promise((resolve) => setTimeout(resolve, 1000));
				}

				// console.log(`getTransaction response: ${JSON.stringify(getResponse)}`);

				if (getResponse.status === 'SUCCESS') {
					// Make sure the transaction's resultMetaXDR is not empty
					if (!getResponse.resultMetaXdr) {
						throw 'Empty resultMetaXDR in getTransaction response';
					}
					// Find the return value from the contract and return it
					const transactionMeta = getResponse.resultMetaXdr;
					const returnValue = transactionMeta
						.v3()
						?.sorobanMeta()
						?.returnValue();

					return returnValue?.value();
				} else {
					throw `Transaction failed: ${getResponse.resultXdr}`;
				}
			} else {
				throw sendResponse?.errorResult;
			}
		} catch (err) {
			// Catch and report any errors we've thrown
			this.logger.error('Sending transaction failed');
			this.logger.error(JSON.stringify(err));
		}
	}
}
