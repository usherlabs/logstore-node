import fs from 'fs';
import path from 'path';

import { createLogStoreNode } from '../../src/node';

const PATH = './configs';

describe('Config', () => {
	it('start with minimal config', async () => {
		const broker = await createLogStoreNode({});
		await broker.start();
		await broker.stop();
	}, 10000);

	const fileNames = fs.readdirSync(PATH).filter(
		// we don't want to test standalone example as it contains invalid stream address
		(fileName) => fileName !== 'standalone-node.example.json'
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
