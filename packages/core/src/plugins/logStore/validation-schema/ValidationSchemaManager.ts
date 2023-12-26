import { LogStoreClient, Stream, StreamID } from '@logsn/client';
import { Logger } from '@streamr/utils';
import {catchError, defer, EMPTY, from, mergeMap, of, Subscription, tap} from 'rxjs';

import { getDefaultAjv } from '../../../config/validateConfig';
import { NodeStreamsRegistry } from '../NodeStreamsRegistry';
import {
	createValidationHandler,
	InvalidSchemaError,
	ValidationSchemaMap,
} from './validationHandler';


const logger = new Logger(module);

export class ValidationSchemaManager {
	private schemaMap: ValidationSchemaMap = new Map();
	private streamSubscriptionsMap = new Map<string, Subscription>();

	public async handleStreamUnregister(stream: Stream) {
		// getting rid of the subscription about this stream
		// e.g. this stream was unstaked or something
		const subscription = this.streamSubscriptionsMap.get(stream.id);
		if (subscription) {
			subscription.unsubscribe();
			this.streamSubscriptionsMap.delete(stream.id);
		}
		if (this.schemaMap.has(stream.id)) {
			// we won't validate this stream anymore
			this.schemaMap.delete(stream.id);
		}
	}

	public async handleStreamRegister(stream: Stream) {
		const ajv = getDefaultAjv();
		const { metadataObservable } = this.logStoreClient.createStreamObservable(
			stream.id,
			// polling every 60 sec. We currently don't have a way to subscribe to stream metadata changes on a push basis
			// if we have, better to implement it on the client
			60_000
		);

		const schema$ = metadataObservable.pipe(
			mergeMap((metadata) =>
				this.logStoreClient.getValidationSchemaFromStreamMetadata(metadata)
			),
			catchError((e) => {
				logger.error(e);

				if (e.message.includes('schema is invalid')) {
					return of(InvalidSchemaError);
				}
				// couldn't fetch or parse the metadata JSON. Something is corrupted in this process.
				// We won't overwrite previous schemas that were OK, probably not user's fault
				return EMPTY;
			})
		);

		const subscription = schema$.subscribe((schema) => {
			// a stream may or may not have a schema
			if (schema) {
				logger.info(`New schema for stream ${stream.id} was found`);
				this.schemaMap.set(stream.id, schema);
			} else {
				// and in case it was deleted, we should delete as well
				this.schemaMap.delete(stream.id);
			}
		});

		this.streamSubscriptionsMap.set(stream.id, subscription);
	}

	constructor(
		private registry: NodeStreamsRegistry,
		private readonly logStoreClient: LogStoreClient,
		private readonly validationErrorsStream: Stream | null
	) {
		this.handleStreamRegister = this.handleStreamRegister.bind(this);
		this.handleStreamUnregister = this.handleStreamUnregister.bind(this);
	}

	// this is what is used by when we receive new messages, then we can decide on storing or not
	public validateMessage = createValidationHandler({
		schemaMap: this.schemaMap,
	});

	public async publishValidationErrors(streamId: StreamID, errors: any) {
		if (!this.validationErrorsStream) {
			// not configured, we won't enforce it
			return;
		} else {
			await this.logStoreClient.publish(this.validationErrorsStream.id, {
				streamId,
				errors,
			});
		}
	}

	async start() {
		// if streams were previously registered, we should process them
		this.registry.getRegisteredStreams().forEach(this.handleStreamRegister);
		// these are for future streams
		this.registry.on('registerStream', this.handleStreamRegister);
		this.registry.on('unregisterStream', this.handleStreamUnregister);
	}

	async stop() {
		// cleaning up
		this.registry.getRegisteredStreams().forEach(this.handleStreamRegister);
		// stop listening for future streams
		this.registry.off('registerStream', this.handleStreamRegister);
		this.registry.off('unregisterStream', this.handleStreamRegister);
	}
}
