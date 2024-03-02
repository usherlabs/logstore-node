// @generated by protobuf-ts 2.9.3
// @generated from protobuf file "prover.proto" (package "socket", syntax proto3)
// tslint:disable
import type { BinaryWriteOptions } from '@protobuf-ts/runtime';
import type { IBinaryWriter } from '@protobuf-ts/runtime';
import { WireType } from '@protobuf-ts/runtime';
import type { BinaryReadOptions } from '@protobuf-ts/runtime';
import type { IBinaryReader } from '@protobuf-ts/runtime';
import { UnknownFieldHandler } from '@protobuf-ts/runtime';
import type { PartialMessage } from '@protobuf-ts/runtime';
import { reflectionMergePartial } from '@protobuf-ts/runtime';
import { MessageType } from '@protobuf-ts/runtime';
import { ServiceType } from '@protobuf-ts/runtime-rpc';

/**
 * @generated from protobuf message socket.TlsProof
 */
export interface TlsProof {
	/**
	 * @generated from protobuf field: string id = 1;
	 */
	id: string;
	/**
	 * @generated from protobuf field: string data = 2;
	 */
	data: string;
	/**
	 * @generated from protobuf field: string stream = 3;
	 */
	stream: string;
	/**
	 * @generated from protobuf field: string process = 4;
	 */
	process: string;
	/**
	 * @generated from protobuf field: string pubkey = 5;
	 */
	pubkey: string; // bool publish = 4;
}
/**
 * @generated from protobuf message socket.TlsProofFilter
 */
export interface TlsProofFilter {}
/**
 * @generated from protobuf message socket.ValidationResult
 */
export interface ValidationResult {}
// @generated message type with reflection information, may provide speed optimized methods
class TlsProof$Type extends MessageType<TlsProof> {
	constructor() {
		super('socket.TlsProof', [
			{ no: 1, name: 'id', kind: 'scalar', T: 9 /*ScalarType.STRING*/ },
			{ no: 2, name: 'data', kind: 'scalar', T: 9 /*ScalarType.STRING*/ },
			{ no: 3, name: 'stream', kind: 'scalar', T: 9 /*ScalarType.STRING*/ },
			{ no: 4, name: 'process', kind: 'scalar', T: 9 /*ScalarType.STRING*/ },
			{ no: 5, name: 'pubkey', kind: 'scalar', T: 9 /*ScalarType.STRING*/ },
		]);
	}
	create(value?: PartialMessage<TlsProof>): TlsProof {
		const message = globalThis.Object.create(this.messagePrototype!);
		message.id = '';
		message.data = '';
		message.stream = '';
		message.process = '';
		message.pubkey = '';
		if (value !== undefined)
			reflectionMergePartial<TlsProof>(this, message, value);
		return message;
	}
	internalBinaryRead(
		reader: IBinaryReader,
		length: number,
		options: BinaryReadOptions,
		target?: TlsProof
	): TlsProof {
		const message = target ?? this.create(),
			end = reader.pos + length;
		while (reader.pos < end) {
			const [fieldNo, wireType] = reader.tag();
			switch (fieldNo) {
				case /* string id */ 1:
					message.id = reader.string();
					break;
				case /* string data */ 2:
					message.data = reader.string();
					break;
				case /* string stream */ 3:
					message.stream = reader.string();
					break;
				case /* string process */ 4:
					message.process = reader.string();
					break;
				case /* string pubkey */ 5:
					message.pubkey = reader.string();
					break;
				default:
					const u = options.readUnknownField;
					if (u === 'throw')
						throw new globalThis.Error(
							`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`
						);
					const d = reader.skip(wireType);
					if (u !== false)
						(u === true ? UnknownFieldHandler.onRead : u)(
							this.typeName,
							message,
							fieldNo,
							wireType,
							d
						);
			}
		}
		return message;
	}
	internalBinaryWrite(
		message: TlsProof,
		writer: IBinaryWriter,
		options: BinaryWriteOptions
	): IBinaryWriter {
		/* string id = 1; */
		if (message.id !== '')
			writer.tag(1, WireType.LengthDelimited).string(message.id);
		/* string data = 2; */
		if (message.data !== '')
			writer.tag(2, WireType.LengthDelimited).string(message.data);
		/* string stream = 3; */
		if (message.stream !== '')
			writer.tag(3, WireType.LengthDelimited).string(message.stream);
		/* string process = 4; */
		if (message.process !== '')
			writer.tag(4, WireType.LengthDelimited).string(message.process);
		/* string pubkey = 5; */
		if (message.pubkey !== '')
			writer.tag(5, WireType.LengthDelimited).string(message.pubkey);
		const u = options.writeUnknownFields;
		if (u !== false)
			(u == true ? UnknownFieldHandler.onWrite : u)(
				this.typeName,
				message,
				writer
			);
		return writer;
	}
}
/**
 * @generated MessageType for protobuf message socket.TlsProof
 */
export const TlsProof = new TlsProof$Type();
// @generated message type with reflection information, may provide speed optimized methods
class TlsProofFilter$Type extends MessageType<TlsProofFilter> {
	constructor() {
		super('socket.TlsProofFilter', []);
	}
	create(value?: PartialMessage<TlsProofFilter>): TlsProofFilter {
		const message = globalThis.Object.create(this.messagePrototype!);
		if (value !== undefined)
			reflectionMergePartial<TlsProofFilter>(this, message, value);
		return message;
	}
	internalBinaryRead(
		reader: IBinaryReader,
		length: number,
		options: BinaryReadOptions,
		target?: TlsProofFilter
	): TlsProofFilter {
		return target ?? this.create();
	}
	internalBinaryWrite(
		message: TlsProofFilter,
		writer: IBinaryWriter,
		options: BinaryWriteOptions
	): IBinaryWriter {
		const u = options.writeUnknownFields;
		if (u !== false)
			(u == true ? UnknownFieldHandler.onWrite : u)(
				this.typeName,
				message,
				writer
			);
		return writer;
	}
}
/**
 * @generated MessageType for protobuf message socket.TlsProofFilter
 */
export const TlsProofFilter = new TlsProofFilter$Type();
// @generated message type with reflection information, may provide speed optimized methods
class ValidationResult$Type extends MessageType<ValidationResult> {
	constructor() {
		super('socket.ValidationResult', []);
	}
	create(value?: PartialMessage<ValidationResult>): ValidationResult {
		const message = globalThis.Object.create(this.messagePrototype!);
		if (value !== undefined)
			reflectionMergePartial<ValidationResult>(this, message, value);
		return message;
	}
	internalBinaryRead(
		reader: IBinaryReader,
		length: number,
		options: BinaryReadOptions,
		target?: ValidationResult
	): ValidationResult {
		return target ?? this.create();
	}
	internalBinaryWrite(
		message: ValidationResult,
		writer: IBinaryWriter,
		options: BinaryWriteOptions
	): IBinaryWriter {
		const u = options.writeUnknownFields;
		if (u !== false)
			(u == true ? UnknownFieldHandler.onWrite : u)(
				this.typeName,
				message,
				writer
			);
		return writer;
	}
}
/**
 * @generated MessageType for protobuf message socket.ValidationResult
 */
export const ValidationResult = new ValidationResult$Type();
/**
 * @generated ServiceType for protobuf service socket.Socket
 */
export const Socket = new ServiceType('socket.Socket', [
	{
		name: 'subscribeToProofs',
		serverStreaming: true,
		options: { 'socket.zmq_type': 'sub' },
		I: TlsProofFilter,
		O: TlsProof,
	},
	{
		name: 'validate',
		options: { 'socket.zmq_type': 'reply' },
		I: TlsProof,
		O: ValidationResult,
	},
]);
