import {
	LogStoreClient,
	NetworkNodeStub,
	PrivateKeyAuthConfig,
	validateConfig as validateClientConfig,
} from '@logsn/client';
import { getNodeManagerContract } from '@logsn/shared';
import { toStreamID } from '@streamr/protocol';
import { Logger, toEthereumAddress } from '@streamr/utils';
import { ethers } from 'ethers';
import { Server as HttpServer } from 'http';
import { Server as HttpsServer } from 'https';
import _ from 'lodash';

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
	validateClientConfig(config.client);

	// Tweaks suggested by the Streamr Team
	config.client.network!.webrtcSendBufferMaxMessageCount = 5000;
	config.client.gapFill = true;
	config.client.gapFillTimeout = 30 * 1000;

	const logStoreClient = new LogStoreClient(config.client);

	const nodeManagerAddress = toEthereumAddress(
		config.client.contracts!.logStoreNodeManagerChainAddress!
	);

	const privateKey = (config.client!.auth as PrivateKeyAuthConfig).privateKey;

	const provider = new ethers.providers.JsonRpcProvider(
		config.client!.contracts?.streamRegistryChainRPCs!.rpcs[0]
	);
	const signer = new ethers.Wallet(privateKey, provider);

	const nodeManagerStream = _.flow(
		_.partial(toStreamID, _, nodeManagerAddress),
		(v) => logStoreClient.getStream(v)
	);

	// `topicsStream` may be defined directly by the config if in 'standalone' mode, or it could be null if not configured.
	// In 'network' mode, it will be obtained from the default stream of the nodeManager.
	const topicsStream = await (async () => {
		if (config.mode.type === 'standalone') {
			return config.mode.topicsStream
				? await logStoreClient.getStream(config.mode.topicsStream)
				: null;
		} else {
			return await nodeManagerStream('/topics');
		}
	})();

	// same as topics stream comment
	const validationErrorsStream = await (async () => {
		if (config.mode.type === 'standalone') {
			return config.mode.validationErrorsStream
				? await logStoreClient.getStream(config.mode.validationErrorsStream)
				: null;
		} else {
			return await nodeManagerStream('/validation-errors');
		}
	})()

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
		return logStoreClient.getNode();
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

			const nodeId = (await logStoreClient.getNode()).getNodeId();
			const nodeAddress = await logStoreClient.getAddress();
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
					config.client.network?.trackers
						? JSON.stringify(config.client.network?.trackers)
						: 'default'
				}`
			);

			logger.info(`Plugins: ${JSON.stringify(plugins.map((p) => p.name))}`);

			if (
				config.client.network?.webrtcDisallowPrivateAddresses === undefined ||
				config.client.network.webrtcDisallowPrivateAddresses
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
			await logStoreClient.destroy();
		},
	};
};

process.on('uncaughtException', (err) => {
	logger.getFinalLogger().error(err, 'uncaughtException');
	process.exit(1);
});

process.on('unhandledRejection', (err) => {
	logger.getFinalLogger().error(err, 'unhandledRejection');
	process.exit(1);
});
