import { Schema } from 'ajv';
import { ApiPluginConfig } from 'streamr-broker/dist/src/Plugin';
import PLUGIN_CONFIG_SCHEMA from 'streamr-broker/dist/src/plugins/http/config.schema.json';
import { createEndpoint } from 'streamr-broker/dist/src/plugins/http/publishEndpoint';

import { Plugin } from '../../Plugin';

export class HttpPlugin extends Plugin<ApiPluginConfig> {
	async start(): Promise<void> {
		this.addHttpServerEndpoint({
			// @ts-expect-error
			...createEndpoint(this.streamrClient),
			apiAuthentication: this.getApiAuthentication(),
		});
	}

	// eslint-disable-next-line class-methods-use-this
	async stop(): Promise<void> {}

	// eslint-disable-next-line class-methods-use-this
	override getConfigSchema(): Schema {
		return PLUGIN_CONFIG_SCHEMA;
	}
}
