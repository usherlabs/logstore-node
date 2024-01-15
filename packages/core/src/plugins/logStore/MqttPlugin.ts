import { Schema } from 'ajv';
import { getPayloadFormat } from 'streamr-broker/dist/src/helpers/PayloadFormat';
import { ApiPluginConfig } from 'streamr-broker/dist/src/Plugin';
import { Bridge } from 'streamr-broker/dist/src/plugins/mqtt/Bridge';
import PLUGIN_CONFIG_SCHEMA from 'streamr-broker/dist/src/plugins/mqtt/config.schema.json';
import { MqttServer } from 'streamr-broker/dist/src/plugins/mqtt/MqttServer';

import { Plugin } from '../../Plugin';

export interface MqttPluginConfig extends ApiPluginConfig {
	port: number;
	streamIdDomain?: string;
	payloadMetadata: boolean;
}

export class MqttPlugin extends Plugin<MqttPluginConfig> {
	private server?: MqttServer;

	async start(): Promise<void> {
		this.server = new MqttServer(
			this.pluginConfig.port,
			this.getApiAuthentication()
		);
		const bridge = new Bridge(
			// @ts-expect-error versions differ, but should be ok here
			this.streamrClient,
			this.server,
			getPayloadFormat(this.pluginConfig.payloadMetadata),
			this.pluginConfig.streamIdDomain
		);
		this.server.setListener(bridge);
		return this.server.start();
	}

	// eslint-disable-next-line class-methods-use-this
	async stop(): Promise<void> {
		await this.server!.stop();
	}

	// eslint-disable-next-line class-methods-use-this
	override getConfigSchema(): Schema {
		return PLUGIN_CONFIG_SCHEMA;
	}
}
