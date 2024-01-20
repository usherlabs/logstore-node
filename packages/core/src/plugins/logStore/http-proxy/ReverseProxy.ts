import { Subscription } from 'rxjs';

import { StrictConfig } from '../../../config/config';
import { RegisterProxyPath, reverseProxyFromNodeConfig } from './tinyProxy';

/**
 * Starting the ReverseProxy mutates the nodeConfig object, as it needs to swap the ports.
 * We want our user to access the proxy when he makes a request to the port he configured.
 * From his perspective, nothing should change.
 */
export class ReverseProxy {
	public registerProxyPath: RegisterProxyPath;
	public start: () => Promise<unknown>;
	public stop: () => Promise<void>;

	constructor(nodeConfig: StrictConfig) {
		const proxy = reverseProxyFromNodeConfig(nodeConfig);
		this.registerProxyPath = proxy.registerProxyPath;
		let reverseProxySubscription: Subscription | undefined;

		// Waits for the reverse proxy to start and swap the ports
		// This happens because we will run a thin reverse proxy from this same process.
		this.start = async () =>
			new Promise((resolve) => {
				reverseProxySubscription =
					proxy.startReverseProxyAndSwapPorts$.subscribe(resolve);
			}
		);

		this.stop = async () => {
			if (reverseProxySubscription) {
				reverseProxySubscription.unsubscribe();
			}
		}
	}
}
