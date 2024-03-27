import { Tracker } from '@streamr/network-tracker';
import { KeyServer } from '@streamr/test-utils';
import { providers, Wallet } from 'ethers';
import { Stream } from 'streamr-client';
import { CONFIG_TEST as STREAMR_CLIENT_CONFIG_TEST } from 'streamr-client/types/src/ConfigTest';

import { accountUtils, getLogStoreNodeTestUtils } from '../../../resourceUtils';
import { CONTRACT_OWNER_PRIVATE_KEY, createTestStream, startTestTracker } from '../../../utils';

jest.setTimeout(60000);

// There are two options to run the test managed by a value of the TRACKER_PORT constant:
// 1. TRACKER_PORT = undefined - run the test against the brokers running in dev-env and brokers run by the test script.
// 2. TRACKER_PORT = 17771 - run the test against only brokers run by the test script.
//    In this case dev-env doesn't run any brokers and there is no brokers joined the network (NodeManager.totalNodes == 0)
const TRACKER_PORT = undefined;

describe('Network Mode Queries', () => {
	const provider = new providers.JsonRpcProvider(
		STREAMR_CLIENT_CONFIG_TEST.contracts?.streamRegistryChainRPCs?.rpcs[0].url,
		STREAMR_CLIENT_CONFIG_TEST.contracts?.streamRegistryChainRPCs?.chainId
	);

	const fullNodeUtils = getLogStoreNodeTestUtils(
		provider,
		{
			plugins: {
				logStore: { db: { type: 'sqlite' } }
			},
			httpServerPort: 7171
		},
		TRACKER_PORT
	);
	const partialNodeUtils = getLogStoreNodeTestUtils(
		provider,
		{
			plugins: {
				logStore: { db: { type: 'sqlite' } }
			},
			httpServerPort: 7172,
			mode: {
				includeOnly: ['**/*-include-test-stream'],
				type: 'network'
			}
		},
		TRACKER_PORT
	);

	// Accounts
	const client = accountUtils(provider);

	let tracker: Tracker;

	let nonIncludedStream: Stream;
	let includedStream: Stream;
	const includedStreamId = `/${Date.now()}-include-test-stream`;

	beforeAll(async () => {
		await client.setup();
		nonIncludedStream = await createTestStream(client.streamrClient, module);
		includedStream = await client.streamrClient.createStream(includedStreamId);

		await client.stakeStream(nonIncludedStream.id);
		await client.stakeStream(includedStream.id);
		await client.stakeQuery();
	});

	afterAll(async () => {
		// TODO: Setup global tear-down
		await KeyServer.stopIfRunning();
		await client.teardown();
	});

	beforeEach(async () => {
		if (TRACKER_PORT) {
			tracker = await startTestTracker(TRACKER_PORT);
		}
		const adminWallet = new Wallet(CONTRACT_OWNER_PRIVATE_KEY, provider);
		await fullNodeUtils.setup(adminWallet, { http: 'http://127.0.0.1:7171' });
		await partialNodeUtils.setup(adminWallet, {});
	});

	afterEach(async () => {
		await fullNodeUtils.teardown();
		await partialNodeUtils.teardown();
		await tracker?.stop();
	});

	test('query partial node - included stream', async () => {
		const messageStream = await client
			.logStoreClientForNodeUrl('http://localhost:7172')
			.query({ streamId: includedStreamId }, { last: 1 });

		for await (const message of messageStream) {
			expect(message).toBeDefined();
		}
	});
});
