import { Schema } from 'ajv';
import { getPayloadFormat } from 'streamr-broker/dist/src/helpers/PayloadFormat';
import { ApiPluginConfig } from 'streamr-broker/dist/src/Plugin';
import PLUGIN_CONFIG_SCHEMA from 'streamr-broker/dist/src/plugins/websocket/config.schema.json';
import { WebsocketServer } from 'streamr-broker/dist/src/plugins/websocket/WebsocketServer';

import { Plugin } from '../../Plugin';

export interface WebsocketPluginConfig extends ApiPluginConfig {
	port: number;
	payloadMetadata: boolean;
	pingSendInterval: number;
	disconnectTimeout: number;
	sslCertificate?: {
		privateKeyFileName: string;
		certFileName: string;
	};
}

export class WebsocketPlugin extends Plugin<WebsocketPluginConfig> {
	private server?: WebsocketServer;

	async start(): Promise<void> {
		this.server = new WebsocketServer(
			// @ts-expect-error - unharmful version mismatch
			this.streamrClient,
			this.pluginConfig.pingSendInterval,
			this.pluginConfig.disconnectTimeout
		);
		await this.server.start(
			this.pluginConfig.port,
			getPayloadFormat(this.pluginConfig.payloadMetadata),
			this.getApiAuthentication(),
			this.pluginConfig.sslCertificate
		);
	}

	async stop(): Promise<void> {
		await this.server!.stop();
	}

	// eslint-disable-next-line class-methods-use-this
	override getConfigSchema(): Schema {
		return PLUGIN_CONFIG_SCHEMA;
	}
}
