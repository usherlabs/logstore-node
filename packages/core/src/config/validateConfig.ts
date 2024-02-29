import Ajv, { ErrorObject, Schema } from 'ajv';
import type { Options } from 'ajv';
import { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

import { StrictConfig } from './config';

export function getDefaultAjv(useDefaults = true, options?: Options) {
	const ajv = new Ajv({
		useDefaults,
		discriminator: true,
		...options,
	});

	addFormats(ajv);
	ajv.addFormat('ethereum-address', /^0x[a-zA-Z0-9]{40}$/);

	return ajv;
}

export const validateConfig = (
	data: unknown,
	schema: Schema,
	contextName?: string,
	useDefaults = true
): StrictConfig => {
	const errors = getValidationErrors(data, schema, useDefaults, contextName);
	if (errors.length > 0) {
		throw new Error(errors.join('\n'));
	}
	return data as StrictConfig;
};

export const getValidationErrors = (
	data: unknown,
	schemaOrValidateFn: Schema | ValidateFunction,
	useDefaults = true,
	contextName?: string
): string[] => {
	const ajv = getDefaultAjv(useDefaults);
	const validate =
		typeof schemaOrValidateFn === 'function'
			? schemaOrValidateFn
			: ajv.compile(schemaOrValidateFn);

	if (!validate(data)) {
		const prefix = contextName !== undefined ? contextName + ': ' : '';
		return (
			validate.errors?.map((e: ErrorObject) => {
				let text = ajv.errorsText([e], { dataVar: '' }).trim();
				if (e.params.additionalProperty) {
					text += ` (${e.params.additionalProperty})`;
				}
				return prefix + text;
			}) ?? []
		);
	}
	return [];
};

export const isValidConfig = (data: unknown, schema: Schema): boolean => {
	try {
		validateConfig(data, schema, undefined, false);
		return true;
	} catch (_e) {
		return false;
	}
};
