import { PromiseOrValue } from '@logsn/contracts/dist/common';
import { Logger } from '@streamr/utils';
import fs from 'fs';
import { spawnSync } from 'node:child_process';
import path from 'path';
import {
	catchError,
	defer,
	map,
	mergeAll,
	mergeMap,
	share,
	throwError,
} from 'rxjs';

import { StrictConfig } from '../../../config/config';
import { projectRootDirectory } from '../../../utils/paths';
import {
	fromProcess,
	getNextAvailablePort,
	tmpFilePathFromContent,
} from './utils';

const logger = new Logger(module);

export type ReversePath = {
	port: number;
	path: string;
};

// we make this promisable so constructors may also get the port without waiting for the proxy to start
export type MaybePromiseReversePath = {
	port: PromiseOrValue<number>;
	path: PromiseOrValue<string>;
};

export type RegisterProxyPath = (path: MaybePromiseReversePath) => void;

export const getTinyProxyPath = () => {
	const output = spawnSync('which', ['tinyproxy'], { stdio: 'inherit' });
	if (output.status !== 0) {
		const nodeModulesBinDir = path.join(projectRootDirectory, 'node_modules', '.bin');
		console.log({ nodeModulesBinDir });
		const tinyProxyPath = path.join(nodeModulesBinDir, 'tinyproxy');
		// check if exists
		if (fs.existsSync(tinyProxyPath)) {
			return tinyProxyPath;
		} else {
			throw new Error('tinyproxy not found');
		}
	}
	return output.stdout.toString().trim();
};

const tinyProxyFromConfigPath = (configFilePath: string) =>
	fromProcess({
		name: 'tinyproxy',
		cmd: getTinyProxyPath(),
		args: ['-d', '-c', configFilePath],
	}).pipe(
		catchError((err) => {
			logger.error(
				'tinyproxy failed to start, are you sure it is installed?',
				err
			);
			return throwError(() => err);
		})
	);

const textFromTinyConfig = ({
	port,
	paths,
}: {
	port: number;
	ip: string;
	paths: ReversePath[];
}) => `Port ${port}
ReverseOnly Yes
${paths.map(localReversePathStatement).join('\n')}
`;

const localReversePathStatement = ({ port, path }: ReversePath) =>
	`ReversePath "${path}" "http://127.0.0.1:${port}/"`;

export const getTinyProxy = (
	tinyProxyPort: number,
	proxyMappings: ReversePath[]
) => {
	const content = textFromTinyConfig({
		port: tinyProxyPort,
		ip: '127.0.0.1',
		paths: proxyMappings,
	});
	const tmpConfig$ = tmpFilePathFromContent(content);

	return tmpConfig$.pipe(
		mergeMap(tinyProxyFromConfigPath),
		map((tinyProxy) => ({ tinyProxy, port: tinyProxyPort }))
	);
};

/**
 * Starts a reverse proxy and swaps the ports, mutating the config
 *
 * This is needed because we don't the user to manage these ports
 * From his standpoint the node should be running on the same port as configured
 *
 * The plugins that need some port registered may also be running by using `registerProxyPath` to inject their needs
 * @param config
 */
export const reverseProxyFromNodeConfig = (config: StrictConfig) => {
	// this will be passed to plugins so they can register proxies if needed
	const proxyPathsSet = new Set<MaybePromiseReversePath>();
	const registerProxyPath = (path: MaybePromiseReversePath) => {
		proxyPathsSet.add(path);
	};

	const startReverseProxyAndSwapPorts$ = defer(async () => {
		// swap ports
		const originalPort = config.httpServer.port;
		const newPort = await getNextAvailablePort();
		config.httpServer.port = newPort;

		// add proxy path
		registerProxyPath({
			port: newPort,
			path: '/',
		});

		// by this point, where the proxy is being started, we expect all plugins to have registered their
		const awaitedProxyPaths: ReversePath[] = await Promise.all(
			Array.from(proxyPathsSet).map(async (c) => ({
				port: await c.port,
				path: await c.path,
			}))
		);

		const tinyProxy$ = getTinyProxy(originalPort, awaitedProxyPaths.reverse());

		return tinyProxy$;
	}).pipe(mergeAll(), share());

	return {
		startReverseProxyAndSwapPorts$,
		registerProxyPath,
	};
};
