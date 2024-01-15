import { Plugin, PluginOptions } from './Plugin';
import { HttpPlugin } from './plugins/logStore/HttpPlugin';
import { MqttPlugin } from './plugins/logStore/MqttPlugin';
import { LogStoreNetworkPlugin } from './plugins/logStore/network/LogStoreNetworkPlugin';
import { LogStoreStandalonePlugin } from './plugins/logStore/standalone/LogStoreStandalonePlugin';
import { WebsocketPlugin } from './plugins/logStore/WebSocketPlugin';

export const createPlugin = (
	name: string,
	pluginOptions: PluginOptions
): Plugin<any> | never => {
	switch (pluginOptions.name) {
		case 'http':
			return new HttpPlugin(pluginOptions);
		// case 'consoleMetrics':
		//     return new ConsoleMetricsPlugin(pluginOptions)
		case 'websocket':
			return new WebsocketPlugin(pluginOptions);
		case 'mqtt':
			return new MqttPlugin(pluginOptions);
		case 'logStore':
			return pluginOptions.mode.type === 'network'
				? new LogStoreNetworkPlugin(pluginOptions)
				: new LogStoreStandalonePlugin(pluginOptions);
		// case 'brubeckMiner':
		//     return new BrubeckMinerPlugin(pluginOptions)
		// case 'subscriber':
		//     return new SubscriberPlugin(pluginOptions)
		// case 'info':
		//     return new InfoPlugin(pluginOptions)
		default:
			throw new Error(`Unknown plugin: ${name}`);
	}
};
