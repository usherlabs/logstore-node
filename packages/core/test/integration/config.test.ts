import fs from 'fs';
import path from 'path';

import { createLogStoreNode } from '../../src/node';

const PATH = './configs';

// The test skips because LogStore Node cannot run just with minimal config.
// The node requires several steps to perform prior starting i.e. join the network.
// Such required steps are covered by other tests.
describe.skip('Config', () => {
	it('start with minimal config', async () => {
		const broker = await createLogStoreNode({});
		await broker.start();
		await broker.stop();
	}, 10000);

	const fileNames = fs.readdirSync(PATH).filter(
		// we don't want to test standalone example as it contains invalid stream address
		(fileName) => !fileName.startsWith('standalone-node')
	);

	describe.each(fileNames.map((fileName) => [fileName]))(
		'validate',
		(fileName: string) => {
			it(fileName, () => {
				const filePath = PATH + path.sep + fileName;
				const content = fs.readFileSync(filePath);
				const config = JSON.parse(content.toString());
				return expect(createLogStoreNode(config)).resolves.toBeDefined();
			});
		}
	);
});
