import { EncryptionType, StreamMessage } from '@streamr/protocol';
import { Logger } from '@streamr/utils';
import { ValidateFunction } from 'ajv';

import { getValidationErrors } from '../../../config/validateConfig';

export const InvalidSchemaError = Symbol('Invalid schema');

type SchemaValues = ValidateFunction | typeof InvalidSchemaError;
export type ValidationFunctionMap = Map<string, SchemaValues>;

const logger = new Logger(module);

const validateEventFromSchema =
	(valitateFn: ValidateFunction) => (event: any) => {
		const errors = getValidationErrors(event, valitateFn);
		if (errors.length > 0) {
			return { valid: false, errors } as const;
		}

		return { valid: true } as const;
	};

const getSchemaFromMetadata =
	(schemaMap: ValidationFunctionMap) => (streamId: string) => {
		return schemaMap.get(streamId);
	};

export const createValidationHandler =
	({ schemaMap }: { schemaMap: ValidationFunctionMap }) =>
	async (message: StreamMessage<unknown>) => {
		const schema = getSchemaFromMetadata(schemaMap)(message.getStreamId());
		const isEncrypted = message.encryptionType !== EncryptionType.NONE;

		const shouldSkipValidation = isEncrypted || !schema;

		if (shouldSkipValidation) {
			if (isEncrypted) {
				logger.trace(
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
