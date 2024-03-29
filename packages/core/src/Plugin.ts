import { LogStoreClient } from '@logsn/client';
import { LogStoreNodeManager } from '@logsn/contracts';
import StreamrClient, { Stream } from '@streamr/sdk';
import { Schema } from 'ajv';
import { Signer } from 'ethers';

import { StrictConfig } from './config/config';
import { validateConfig } from './config/validateConfig';
import { Endpoint } from './httpServer';

export type NetworkModeConfig = {
	type: 'network';
	heartbeatStream: Stream;
	recoveryStream: Stream;
	systemStream: Stream;
	nodeManager: LogStoreNodeManager;
};

export type StandaloneModeConfig = {
	type: 'standalone';
	trackedStreams: { id: string; partitions: number }[];
};

type PluginModeConfig = NetworkModeConfig | StandaloneModeConfig;

export interface PluginOptions {
	name: string;
	logStoreClient: LogStoreClient;
	streamrClient: StreamrClient;
	mode: PluginModeConfig;
	topicsStream: Stream | null;
	validationErrorsStream: Stream | null;
	nodeConfig: StrictConfig;
	signer: Signer;
}

export type HttpServerEndpoint = Omit<Endpoint, 'apiAuthentication'>;

export abstract class Plugin<T extends object> {
	readonly name: string;
	readonly streamrClient: StreamrClient;
	readonly logStoreClient: LogStoreClient;
	readonly modeConfig: PluginModeConfig;
	readonly nodeConfig: StrictConfig;
	readonly signer: Signer;
	readonly pluginConfig: T;
	private readonly httpServerEndpoints: HttpServerEndpoint[] = [];

	constructor(options: PluginOptions) {
		this.name = options.name;
		this.streamrClient = options.streamrClient;
		this.logStoreClient = options.logStoreClient;
		this.modeConfig = options.mode;
		this.nodeConfig = options.nodeConfig;
		this.signer = options.signer;
		this.pluginConfig = options.nodeConfig.plugins[this.name] as T;
		const configSchema = this.getConfigSchema();
		if (configSchema !== undefined) {
			validateConfig(this.pluginConfig, configSchema, `${this.name} plugin`);
		}
	}

	addHttpServerEndpoint(endpoint: HttpServerEndpoint): void {
		this.httpServerEndpoints.push(endpoint);
	}

	getHttpServerEndpoints(): HttpServerEndpoint[] {
		return this.httpServerEndpoints;
	}

	/**
	 * This lifecycle method is called once when LogStore Node starts
	 */
	abstract start(): Promise<unknown>;

	/**
	 * This lifecycle method is called once when LogStore Node stops
	 * It is be called only if the plugin was started successfully
	 */
	abstract stop(): Promise<unknown>;

	// eslint-disable-next-line class-methods-use-this
	getConfigSchema(): Schema | undefined {
		return undefined;
	}
}
