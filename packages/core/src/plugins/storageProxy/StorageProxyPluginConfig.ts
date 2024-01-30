import { EthereumAddress } from 'streamr-client';

export interface StorageProxyPluginConfig {
	storageConfig: {
		refreshInterval: number;
		storeStakeAmount: string;
	};
	cluster: {
		clusterAddress: EthereumAddress;
	};
}
