import { Logger } from '@streamr/utils';
import { Subscription } from 'rxjs';

import { fromProcess } from './utils';

const logger = new Logger(module);

/**
 * This service would be responsible for handling the running of the binary
 * along with its port and cli args
 */
export class ProcessManager {
	private readonly port: number;
	private subscription?: Subscription;

	constructor(
		private readonly processName: string,
		private readonly cmd: string,
		// if args needs to say what port its exposing, it can be a function
		private readonly args: string[] | ((ctx: { port: number }) => string[]),
		basePort: number,
		readonly isReadyFn?: (log: string) => Promise<boolean> | boolean
	) {
		this.port = basePort;
	}

	async getPort() {
		return this.port;
	}

	// add optional parameter
	async start(extraArgs: string[] = []) {
		const args =
			typeof this.args === 'function'
				? this.args({ port: this.port })
				: this.args;

		await new Promise<void>((resolve) => {
			this.subscription = fromProcess({
				name: this.processName,
				cmd: this.cmd,
				args: [...args, ...extraArgs],
			}).subscribe(({ data, error }) => {
				const prefix = `[${this.processName}] `;

				// program output will be logged here too
				const dataSub = data.subscribe((subData) => {
					if (this.isReadyFn?.(subData)) {
						resolve();
					}
					logger.debug(prefix + subData);
				});
				const errorSub = error.subscribe((subError) => {
					logger.error(prefix + subError);
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

		logger.info(
			`Running MPC-TLS-${this.processName} service on port:${this.port}`
		);
	}

	async stop() {
		this.subscription?.unsubscribe();
	}
}
