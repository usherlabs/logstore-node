import { LogStoreClient, NodeMetadata } from '@logsn/client';
import { LogStoreNodeManager } from '@logsn/contracts';
import {
	getNodeManagerContract,
	getQueryManagerContract,
	getStoreManagerContract,
	getTokenManagerContract,
	prepareStakeForNodeManager,
	prepareStakeForQueryManager,
	prepareStakeForStoreManager,
} from '@logsn/shared';
import { fetchPrivateKeyWithGas } from '@streamr/test-utils';
import { providers, Wallet } from 'ethers';
import StreamrClient from 'streamr-client';

import { LogStoreNode } from '../src/node';
import { LogStoreBrokerTestConfig, sleep, startLogStoreBroker } from './utils';

const STAKE_AMOUNT = BigInt('1000000000000000000');

const getOrError = <T>(value: T | undefined): T => {
	if (value === undefined) {
		throw new Error('Something is not initialized');
	}
	return value;
};
export const getLogStoreNodeTestUtils = (
	provider: providers.Provider,
	logStoreConfig: Omit<LogStoreBrokerTestConfig, 'privateKey' | 'trackerPort'>,
	trackerPort: number | undefined
) => {
	let logstoreNode: LogStoreNode | undefined;
	let wallet: Wallet | undefined;
	let nodeManager: LogStoreNodeManager | undefined;
	return {
		teardown: async () => {
			await getOrError(nodeManager)
				.leave()
				.then((tx) => tx.wait());
			await logstoreNode?.stop();
		},
		wallet: () => getOrError(wallet),
		setup: async (
			adminWallet: Wallet,
			metadata: NodeMetadata
		): Promise<void> => {
			wallet = new Wallet(await fetchPrivateKeyWithGas(), provider);
			const nodeAdminManager = await getNodeManagerContract(adminWallet);
			const tokenAdminManager = await getTokenManagerContract(adminWallet);
			nodeManager = await getNodeManagerContract(wallet);

			await nodeAdminManager
				.whitelistApproveNode(wallet.address)
				.then((tx) => tx.wait());
			await tokenAdminManager
				.addWhitelist(wallet.address, nodeManager.address)
				.then((tx) => tx.wait());

			await prepareStakeForNodeManager(wallet, STAKE_AMOUNT);
			await nodeManager
				.join(STAKE_AMOUNT, JSON.stringify(metadata))
				.then((tx) => tx.wait());

			await sleep(5000);

			logstoreNode = await startLogStoreBroker({
				privateKey: wallet.privateKey,
				trackerPort: trackerPort,
				...logStoreConfig,
			});
			await logstoreNode.start();
		},
	};
};
export const accountUtils = (
	provider: providers.Provider,
	initialWallet?: Wallet
) => {
	let wallet: Wallet | undefined = initialWallet;
	let logStoreClient: LogStoreClient | undefined;
	let streamrClient: StreamrClient | undefined;

	const getWallet = () => getOrError(wallet);

	function getStreamrClient() {
		if (!streamrClient) {
			streamrClient = new StreamrClient({
				auth: {
					privateKey: getWallet().privateKey,
				},
			});
		}
		return streamrClient;
	}

	const logStoreNodeForUrlMap = new Map<string, LogStoreClient>();

	return {
		setup: async () => {
			wallet = new Wallet(await fetchPrivateKeyWithGas(), provider);
		},
		teardown: async () => {
			logStoreClient?.destroy();
			await streamrClient?.destroy();
			Array.from(logStoreNodeForUrlMap.values()).map((client) =>
				client.destroy()
			);
		},
		get streamrClient() {
			return getStreamrClient();
		},
		get logStoreClient() {
			if (!logStoreClient) {
				logStoreClient = new LogStoreClient(getStreamrClient());
			}
			return logStoreClient;
		},
		logStoreClientForNodeUrl: (nodeUrl: string) => {
			if (!logStoreNodeForUrlMap.has(nodeUrl)) {
				logStoreNodeForUrlMap.set(
					nodeUrl,
					new LogStoreClient(getStreamrClient(), { nodeUrl })
				);
			}
			return logStoreNodeForUrlMap.get(nodeUrl)!;
		},
		stakeStream: async (streamId: string) => {
			const storeManager = await getStoreManagerContract(getWallet());
			await prepareStakeForStoreManager(getWallet(), STAKE_AMOUNT);
			await storeManager.stake(streamId, '1').then((tx) => tx.wait());
		},
		stakeQuery: async () => {
			const queryManager = await getQueryManagerContract(getWallet());
			await prepareStakeForQueryManager(getWallet(), STAKE_AMOUNT);
			await queryManager.stake('1').then((tx) => tx.wait());
		},
	};
};
