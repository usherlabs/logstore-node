import { EncryptionType, StreamMessage } from '@streamr/protocol';
import { Logger } from '@streamr/utils';
import { Schema } from 'ajv';

import { getErrors } from '../../../config/validateConfig';


export const InvalidSchemaError = Symbol('Invalid schema');

type SchemaValues = Schema | typeof InvalidSchemaError;
export type ValidationSchemaMap = Map<string, SchemaValues>;

const logger = new Logger(module);

const validateEventFromSchema = (schema: Schema) => (event: any) => {
	const errors = getErrors(event, schema);
	if (errors.length > 0) {
		return { valid: false, errors } as const;
	}

	return { valid: true } as const;
};

const getSchemaFromMetadata =
	(schemaMap: ValidationSchemaMap) => (streamId: string) => {
		return schemaMap.get(streamId);
	};

export const createValidationHandler =
	({ schemaMap }: { schemaMap: ValidationSchemaMap }) =>
	async (message: StreamMessage<unknown>) => {
		const schema = getSchemaFromMetadata(schemaMap)(message.getStreamId());
		const isEncrypted = message.encryptionType !== EncryptionType.NONE;

		const shouldSkipValidation = isEncrypted || !schema;

		if (shouldSkipValidation) {
			if (isEncrypted) {
				logger.warn(
					`Message ${message.getStreamId()} is encrypted, skipping validation`
				);
			}
			return {
				valid: true,
			} as const;
		}

		if (schema === InvalidSchemaError) {
			return { valid: false, errors: ['Invalid schema'] } as const;
		}

		return validateEventFromSchema(schema)(message.getContent());
	};
