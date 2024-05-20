import { LogStoreClientConfig } from '@logsn/client';
import { StreamrClientConfig } from '@streamr/sdk';
import { camelCase, set } from 'lodash';
import * as os from 'os';
import path from 'path';
import { DeepRequired } from 'ts-essentials';

import { LogStorePluginConfig } from '../plugins/logStore/LogStorePlugin';
import { StorageProxyPluginConfig } from '../plugins/storageProxy/StorageProxyPluginConfig';

export type NetworkParticipantMode = {
	type: 'network';
};

type StandaloneMode = {
	type: 'standalone';
	trackedStreams: {
		id: string;
		partitions: number;
	}[];
	validationErrorsStream?: string;
	topicsStream?: string;
};
type Mode = StandaloneMode | NetworkParticipantMode;

export interface Config {
	logStoreClient?: LogStoreClientConfig;
	streamrClient?: StreamrClientConfig;
	mode?: Mode;
	httpServer?: {
		port: number;
		sslCertificate?: {
			privateKeyFileName: string;
			certFileName: string;
		};
	};
	plugins?: {
		logStore?: Partial<LogStorePluginConfig>;
		storageProxy?: Partial<StorageProxyPluginConfig>;
	} & Record<string, unknown>;
}

// StrictConfig is a config object to which some default values have been applied
// (see `default` definitions in config.schema.json)
export type StrictConfig = Config & {
	logStoreClient: Exclude<Config['logStoreClient'], undefined>;
	streamrClient: Exclude<Config['streamrClient'], undefined>;
	plugins: Exclude<Config['plugins'], undefined>;
	httpServer: Exclude<Config['httpServer'], undefined>;
	mode: NonNullable<DeepRequired<Config['mode']>>;
};

export interface ConfigFile extends Config {
	$schema?: string;
}

export const getDefaultFile = (): string => {
	const relativePath = '.logstore/config/default.json';
	return path.join(os.homedir(), relativePath);
};

export function overrideConfigToEnvVarsIfGiven(config: Config): void {
	const parseValue = (value: string) => {
		const number = /^-?\d+\.?\d*$/;
		if (number.test(value)) {
			return Number(value);
		} else if (value === 'true') {
			return true;
		} else if (value === 'false') {
			return false;
		} else if (value == 'null') {
			return null;
		} else {
			return value;
		}
	};

	const PREFIX = 'LOGSTORE__BROKER__';
	Object.keys(process.env).forEach((variableName: string) => {
		if (variableName.startsWith(PREFIX)) {
			const parts = variableName
				.substring(PREFIX.length)
				.split('__')
				.map((part: string) => {
					const groups = part.match(/^([A-Z_]*[A-Z])(_\d+)?$/);
					if (groups !== null) {
						const base = camelCase(groups[1]);
						const suffix = groups[2];
						if (suffix === undefined) {
							return base;
						} else {
							const index = Number(suffix.substring(1)) - 1;
							return `${base}[${index}]`;
						}
					} else {
						throw new Error(`Malformed environment variable ${variableName}`);
					}
				});
			const key = parts.join('.');
			const value = parseValue(process.env[variableName]!);
			if (value !== '') {
				set(config, key, value);
			}
		}
	});
}
