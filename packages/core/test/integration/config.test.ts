import fs from 'fs';
import path from 'path';

import { createLogStoreNode } from '../../src/logStoreNode';

const PATH = './configs';

describe('Config', () => {
	it('start with minimal config', async () => {
		const broker = await createLogStoreNode({});
		await broker.start();
		await broker.stop();
	});

	const fileNames = fs.readdirSync(PATH);

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
