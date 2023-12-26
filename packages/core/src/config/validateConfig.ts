import Ajv, { ErrorObject, Schema } from 'ajv';
import addFormats from 'ajv-formats';

import { StrictConfig } from './config';

export function getDefaultAjv(useDefaults = true) {
	const ajv = new Ajv({
		useDefaults,
		discriminator: true,
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
	const errors = getErrors(data, schema, useDefaults, contextName);
	if (errors.length > 0) {
		throw new Error(errors.join('\n'));
	}
	return data as StrictConfig;
};

export const getErrors = (
	data: unknown,
	schema: Schema,
	useDefaults = true,
	contextName?: string
): string[] => {
	const ajv = getDefaultAjv(useDefaults);

	if (!ajv.validate(schema, data)) {
		const prefix = contextName !== undefined ? contextName + ': ' : '';
		return ajv.errors!.map((e: ErrorObject) => {
			let text = ajv.errorsText([e], { dataVar: '' }).trim();
			if (e.params.additionalProperty) {
				text += ` (${e.params.additionalProperty})`;
			}
			return prefix + text;
		});
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
