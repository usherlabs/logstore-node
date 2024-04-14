// TODO: This Sink module is to be eventually separated into a standalone optional package for the Log Store Node - alongside all dependencies
import { Networks } from '@stellar/stellar-sdk';
import { Logger } from '@streamr/utils';
import { StreamMessage } from 'streamr-client';
import { z } from 'zod';

import { LogStore } from '../../LogStore';
import { SorobanContract } from './soroban';
import { MessagePayload } from './soroban/types';

export const DEFAULT_PROCESS = 'LS_PROCESS';
export const SINK_STELLAR_TRANSPARENCY_CONTRACT =
	'CDPSU7OK7AUC2KQGGAOUWA5VKZDR4WRFEL6K6QLYDO53QEPHSH2R6YZK';
export const SINK_STELLAR_RPC = 'https://soroban-testnet.stellar.org:443';
export const SINK_STELLAR_WALLET_PRIVATE_KEY =
	process.env.SINK_STELLAR_WALLET_PRIVATE_KEY;

type SinkMessageType = {
	action: 'start' | 'stop' | 'meta';
	process?: string;
	metadata?: string;
};
type ProofMessageType = {
	messageHash: string;
	signature: string;
	process: string;
	node: string;
};

type MessageType = 'proof' | 'sink';
type ValidMessageData = ProofMessageType | SinkMessageType;

const MESSAGE_TYPE: Record<MessageType, MessageType> = {
	proof: 'proof',
	sink: 'sink',
};
type ValidMessage = {
	message: ValidMessageData;
	type: MessageType;
	streamrMessage: MessagePayload;
};

// Define a schema for SinkMessage
const sinkMessageSchema = z.object({
	action: z.enum(['start', 'stop', 'meta']),
	process: z.string().optional(),
	metadata: z.string().optional(),
});

// Define a schema for proofs
const proofMessageSchema = z.object({
	messageHash: z.string(),
	signature: z.string(),
	node: z.string(),
	process: z.string(),
});

const logger = new Logger(module);

enum ProcessStatus {
	CREATED,
	STARTED,
	STOPPED,
	COMPLETED,
}

class Process {
	status = ProcessStatus.CREATED;
	store = [] as ValidMessage[];

	constructor() {}

	// this handles how a message
	update(newProcessMessage: ValidMessage) {
		// IF MESSAGE NOT SINK START MESSAGE AND STATUS ISNT STARTED, THEN DO NOTHING
		if (this.isSinkMessageType(newProcessMessage.message)) {
			const sinkMessage = newProcessMessage.message;
			// check if it is a start, stop or meta
			if (sinkMessage.action === 'start') {
				if (
					![ProcessStatus.CREATED, ProcessStatus.STOPPED].includes(this.status)
				)
					return logger.error('Process already started');
				this.status = ProcessStatus.STARTED;
			}
			if (this.status !== ProcessStatus.STARTED)
				return logger.error('Process not active');

			if (sinkMessage.action === 'stop') {
				this.status = ProcessStatus.STOPPED;
			}

			this.store.push(newProcessMessage);
		} else {
			// this is a proof
			// just check if process is started
			if (this.status !== ProcessStatus.STARTED)
				return logger.error('Process not active');
			this.store.push(newProcessMessage);
		}
	}

	// a getter to return the messages stored
	get messages(): ValidMessage[] {
		// if not completed return empty content
		if (!this.isReady()) return [];
		// otherwise take out the start and stop messages
		return this.store.slice(1, this.store.length - 1);
	}

	isReady() {
		// we can mark as ready when it has a start and stop message
		return this.status === ProcessStatus.STOPPED;
	}

	isSinkMessageType(message: ValidMessageData): message is SinkMessageType {
		return true;
	}
}

export class SinkModule {
	private _logStore: LogStore | undefined;
	private activeProcessesMap: Map<string, Process>;
	private verifierContract: SorobanContract;

	constructor() {
		this.activeProcessesMap = new Map<string, Process>();
		// TODO: I don't think this secret key is to be public - we can leave public as we're using Testnet but in the future, the Node operator will provide the Secret Key alongside their Wallet Private Key
		const secret = String(SINK_STELLAR_WALLET_PRIVATE_KEY);
		const rpcURL = String(SINK_STELLAR_RPC);
		const contractAddress = SINK_STELLAR_TRANSPARENCY_CONTRACT;

		if (!secret || !rpcURL)
			throw new Error(
				"Provide env vars 'SINK_STELLAR_WALLET_PRIVATE_KEY' and 'SINK_STELLAR_RPC'"
			);

		this.verifierContract = new SorobanContract(secret, {
			address: contractAddress,
			networkRPC: rpcURL,
			network: Networks.TESTNET,
		});
	}

	async start(logStore: LogStore) {
		this._logStore = logStore;

		// start insert listener
		//? bind the function to this class to guard against unwanted 'this' behaviour
		const newMessageHandler = this.handleNewMessage.bind(this);
		this._logStore.on('write', newMessageHandler);
	}

	async handleNewMessage(message: StreamMessage<unknown>) {
		const validMessage = await this.parseValidMessageType(message);
		if (!validMessage) return;

		// get the process
		const currentProcess = this.getOrCreateProcess(validMessage);
		currentProcess.update(validMessage);

		// if process is ready
		if (currentProcess.isReady()) {
			this.submitProcess(validMessage.message.process || DEFAULT_PROCESS);
		}

		// call the complete method and delete the process
	}

	async submitProcess(processId: string) {
		// get the data from this process
		const process = this.activeProcessesMap.get(processId)!;
		const messages = process.messages;

		if (!messages.length) return logger.error('no proofs to submit');
		// send process to spraban smart contract where events would be emitted
		if (await this.sendToContract(messages, processId)) {
			// after process has been submitted then delete the process from memory
			this.activeProcessesMap.delete(processId);
		}
	}

	async sendToContract(messages: ValidMessage[], processId: string) {
		try {
			logger.info(
				`Process:${processId} has been completed and ${messages.length} proofs are prepared to be sent to the soroban contract`
			);
			const messagePayload = messages.map((m) => m.streamrMessage);
			// smart contract submission logic
			const tx = await this.verifierContract.buildVerificationTransaction(
				messagePayload,
				processId
			);
			logger.info(`Built transaction ${tx} and submitting to smart contract`);
			const response = await this.verifierContract.submitTransaction(tx);
			logger.info(`gotten a response:${response}`);
			return response;
		} catch (e) {
			logger.error(e.message);
			return false;
		}
	}

	// ? stop
	async stop() {
		// stop insert listener
		// delete all processes? does it matter it will be cleared from memory either way
	}

	// when we get a message we need to validate if it is a type of message we wanna process
	//? need to account for private stream's encrypted data, right now it assumes public stream
	async parseValidMessageType(
		message: StreamMessage<unknown>
	): Promise<ValidMessage | undefined> {
		// is it a tlsproof message received over the stream
		const streamrMessage: MessagePayload = {
			...message,
			// we serialize this field before sending it over
			newGroupKey: message.newGroupKey?.serialize(),
		};
		const tlsn = this.safeParse(() =>
			proofMessageSchema.parse(message.getContent())
		);
		if (tlsn)
			return { message: tlsn, type: MESSAGE_TYPE.proof, streamrMessage };

		// is it a relevant sink message received over the stream?
		const sinkMessage = this.safeParse(() =>
			sinkMessageSchema.parse(message.getContent())
		);
		if (sinkMessage)
			return { message: sinkMessage, type: MESSAGE_TYPE.sink, streamrMessage };

		// its just a random message on this stream that we need to do nothing about
	}

	getOrCreateProcess(processMessage: ValidMessage) {
		const processOrDefault = processMessage.message?.process || DEFAULT_PROCESS;
		logger.info(
			`Gotten a '${processMessage.type}' message for process:${processOrDefault}`
		);
		const currentProcess =
			// ?new process should take in a process id?
			this.activeProcessesMap.get(processOrDefault) ?? new Process();

		this.activeProcessesMap.set(processOrDefault, currentProcess);
		return currentProcess;
	}

	safeParse<T>(unsafeFn: () => T): T | undefined {
		try {
			return unsafeFn();
		} catch (err) {
			logger.error(err.message);
		}
	}
}
