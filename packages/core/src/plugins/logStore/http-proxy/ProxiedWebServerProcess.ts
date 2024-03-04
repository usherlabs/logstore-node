import { Logger } from '@streamr/utils';
import { Subscription } from 'rxjs';

import { ReverseProxy } from './ReverseProxy';
import { fromProcess, getNextAvailablePort } from './utils';

const logger = new Logger(module);

/**
 * As a child of this nodeJS process, we will have a thin reverse proxy.
 * This will be used to proxy requests to these processes, which will be started by the nodeJS process too.
 * That's why we register the proxy path here, before we start the node.
 */
export class ProxiedWebServerProcess {
	private readonly portPromise: Promise<number>;
	private subscription?: Subscription;

	constructor(
		private readonly processName: string,
		private readonly cmd: string,
		// if args needs to say what port its exposing, it can be a function
		private readonly args: string[] | ((ctx: { port: number }) => string[]),
		readonly path: string,
		readonly reverseProxy: ReverseProxy,
		readonly isReadyFn?: (log: string) => Promise<boolean> | boolean
	) {
		this.portPromise = getNextAvailablePort();

		reverseProxy.registerProxyPath({
			port: this.portPromise,
			path,
		});
	}

	async getPort() {
		return this.portPromise;
	}

	// add optional parameter
	async start(extraArgs: string[] = []) {
		const port = await this.portPromise;

		const args =
			typeof this.args === 'function' ? this.args({ port }) : this.args;

		await new Promise<void>((resolve) => {
			this.subscription = fromProcess({
				name: this.processName,
				cmd: this.cmd,
				args: [...args, ...extraArgs],
			}).subscribe(({ data, error }) => {
				const prefix = `[${this.processName}] `;

				// program output will be logged here too
				const dataSub = data.subscribe((data) => {
					if (this.isReadyFn?.(data)) {
						resolve();
					}
					logger.debug(prefix + data);
				});
				const errorSub = error.subscribe((error) => {
					logger.error(prefix + error);
				});

				this.subscription?.add(() => {
					dataSub.unsubscribe();
					errorSub.unsubscribe();
				});

				if (!this.isReadyFn) {
					resolve();
				}
			});
		});
	}

	async stop() {
		this.subscription?.unsubscribe();
	}
}
