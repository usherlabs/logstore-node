import {
	LogStoreClient,
	validateConfig as validateLogStoreClientConfig,
} from '@logsn/client';
import { getNodeManagerContract } from '@logsn/shared';
import { toStreamID } from '@streamr/protocol';
import { Logger, toEthereumAddress } from '@streamr/utils';
import { Server as HttpServer } from 'http';
import { Server as HttpsServer } from 'https';
import _ from 'lodash';
import { NetworkNodeStub, StreamrClient } from 'streamr-client';

import { version as CURRENT_VERSION } from '../package.json';
import { Config } from './config/config';
import NODE_CONFIG_SCHEMA from './config/config.schema.json';
import { validateConfig } from './config/validateConfig';
import { generateMnemonicFromAddress } from './helpers/generateMnemonicFromAddress';
import { startServer as startHttpServer, stopServer } from './httpServer';
import { HttpServerEndpoint, Plugin, PluginOptions } from './Plugin';
import { createPlugin } from './pluginRegistry';

const logger = new Logger(module);

export interface LogStoreNode {
	getNode: () => Promise<NetworkNodeStub>;
	start: () => Promise<unknown>;
	stop: () => Promise<unknown>;
}

export const createLogStoreNode = async (
	configWithoutDefaults: Config
): Promise<LogStoreNode> => {
	const config = validateConfig(configWithoutDefaults, NODE_CONFIG_SCHEMA);
	validateLogStoreClientConfig(config.logStoreClient);

	// Tweaks suggested by the Streamr Team
	config.streamrClient.network = {
		...config.streamrClient.network,
		webrtcSendBufferMaxMessageCount: 5000,
	};
	config.streamrClient.gapFill = true;
	config.streamrClient.gapFillTimeout = 30 * 1000;

	const streamrClientConfig = config.streamrClient;
	const streamrClient = new StreamrClient(streamrClientConfig);
	const logStoreClient = new LogStoreClient(
		streamrClient,
		config.logStoreClient
	);

	const nodeManagerAddress = toEthereumAddress(
		config.logStoreClient.contracts!.logStoreNodeManagerChainAddress!
	);

	const signer = await logStoreClient.getSigner();

	const nodeManagerStream = _.flow(
		_.partial(toStreamID, _, nodeManagerAddress),
		(v) => streamrClient.getStream(v)
	);

	// `topicsStream` may be defined directly by the config if in 'standalone' mode, or it could be null if not configured.
	// In 'network' mode, it will be obtained from the default stream of the nodeManager.
	const topicsStream = await (async () => {
		if (config.mode.type === 'standalone') {
			return config.mode.topicsStream
				? await streamrClient.getStream(config.mode.topicsStream)
				: null;
		} else {
			return await nodeManagerStream('/topics');
		}
	})();

	// same as topics stream comment
	const validationErrorsStream = await (async () => {
		if (config.mode.type === 'standalone') {
			return config.mode.validationErrorsStream
				? await streamrClient.getStream(config.mode.validationErrorsStream)
				: null;
		} else {
			return await nodeManagerStream('/validation-errors');
		}
	})();

	const modeConfig: PluginOptions['mode'] =
		config.mode.type === 'network'
			? {
					type: 'network',
					heartbeatStream: await nodeManagerStream('/heartbeat'),
					recoveryStream: await nodeManagerStream('/recovery'),
					systemStream: await nodeManagerStream('/system'),
					nodeManager: await getNodeManagerContract(signer),
			  }
			: config.mode;

	const plugins: Plugin<any>[] = Object.keys(config.plugins).map((name) => {
		const pluginOptions: PluginOptions = {
			name,
			logStoreClient,
			streamrClient,
			mode: modeConfig,
			nodeConfig: config,
			topicsStream,
			validationErrorsStream,
			signer,
		};
		return createPlugin(name, pluginOptions);
	});

	let started = false;
	let httpServer: HttpServer | HttpsServer | undefined;

	const getNode = async (): Promise<NetworkNodeStub> => {
		if (!started) {
			throw new Error('cannot invoke on non-started logStore node');
		}
		return streamrClient.getNode();
	};

	return {
		getNode,
		start: async () => {
			logger.info(`Starting LogStore node version ${CURRENT_VERSION}`);
			await Promise.all(plugins.map((plugin) => plugin.start()));
			const httpServerEndpoints = plugins.flatMap((plugin: Plugin<any>) => {
				return plugin
					.getHttpServerEndpoints()
					.map((endpoint: HttpServerEndpoint) => {
						return {
							...endpoint,
						};
					});
			});
			if (httpServerEndpoints.length > 0) {
				httpServer = await startHttpServer(
					httpServerEndpoints,
					config.httpServer
				);
			}

			const nodeId = (await streamrClient.getNode()).getNodeId();
			const nodeAddress = await streamrClient.getAddress();
			const mnemonic = generateMnemonicFromAddress(
				toEthereumAddress(nodeAddress)
			);

			if (config.mode.type === 'standalone') {
				logger.info(`Running in standalone mode.`);
			} else {
				logger.info(`Running in network mode.`);
				logger.info(
					`Welcome to the LogStore Network. Your node's generated name is ${mnemonic}.`
				);
				// TODO: Network Explorer link
				logger.info(
					`View your node in the Network Explorer: https://streamr.network/network-explorer/nodes/${encodeURIComponent(
						nodeId
					)}`
				);
			}
			logger.info(`Network node ${nodeId} running`);
			logger.info(`Ethereum address ${nodeAddress}`);
			logger.info(
				`Tracker Configuration: ${
					config.streamrClient.network?.trackers
						? JSON.stringify(config.streamrClient.network?.trackers)
						: 'default'
				}`
			);

			logger.info(`Plugins: ${JSON.stringify(plugins.map((p) => p.name))}`);

			if (
				config.streamrClient.network?.webrtcDisallowPrivateAddresses ===
					undefined ||
				config.streamrClient.network.webrtcDisallowPrivateAddresses
			) {
				logger.warn(
					'WebRTC private address probing is disabled. ' +
						'This makes it impossible to create network layer connections directly via local routers ' +
						'More info: https://github.com/streamr-dev/network-monorepo/wiki/WebRTC-private-addresses'
				);
			}
			started = true;
		},
		stop: async () => {
			if (httpServer !== undefined) {
				await stopServer(httpServer);
			}
			await Promise.all(plugins.map((plugin) => plugin.stop()));
			logStoreClient.destroy();
			await streamrClient.destroy();
		},
	};
};

process.on('uncaughtException', (err) => {
	logger.fatal('Encountered uncaughtException', { err });
	process.exit(1);
});

process.on('unhandledRejection', (err) => {
	logger.fatal('Encountered unhandledRejection', { err });
	process.exit(1);
});
