import Ajv, { ErrorObject, Schema } from 'ajv';
import addFormats from 'ajv-formats';

import { StrictConfig } from './config';

export function getDefaultAjv(useDefaults = true) {
	return new Ajv({
		useDefaults,
		discriminator: true,
	});
}

export const validateConfig = (
	data: unknown,
	schema: Schema,
	contextName?: string,
	useDefaults = true
): StrictConfig => {
	const ajv = getDefaultAjv(useDefaults);
	addFormats(ajv);
	ajv.addFormat('ethereum-address', /^0x[a-zA-Z0-9]{40}$/);
	if (!ajv.validate(schema, data)) {
		const prefix = contextName !== undefined ? contextName + ': ' : '';
		throw new Error(
			prefix +
				ajv
					.errors!.map((e: ErrorObject) => {
						let text = ajv.errorsText([e], { dataVar: '' }).trim();
						if (e.params.additionalProperty) {
							text += ` (${e.params.additionalProperty})`;
						}
						return text;
					})
					.join('\n')
		);
	}
	return data as StrictConfig;
};

export const isValidConfig = (data: unknown, schema: Schema): boolean => {
	try {
		validateConfig(data, schema, undefined, false);
		return true;
	} catch (_e) {
		return false;
	}
};
