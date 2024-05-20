import { EthereumAddress } from '@streamr/sdk';

export interface StorageProxyPluginConfig {
	storageConfig: {
		refreshInterval: number;
		storeStakeAmount: string;
	};
	cluster: {
		clusterAddress: EthereumAddress;
	};
}
