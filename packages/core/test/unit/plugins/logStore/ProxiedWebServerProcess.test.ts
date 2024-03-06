import fetch from 'node-fetch';

import { BinaryProcess } from '../../../../src/plugins/logStore/http-proxy/BinaryProcess';
import { sleep, TEST_WEBSERVER_PATH } from '../../../utils';

describe('BinaryProcess', () => {
	it('should execute the test script', async () => {
		process.env.LOG_LEVEL = 'debug';
		const proxiedProcess = new BinaryProcess(
			'test',
			TEST_WEBSERVER_PATH,
			({ port }) => ['--port', port.toString()],
			8080
			// this is not working, maybe because the python script streams the output in buffers
			// (log) => log.includes('Listening on port')
		);
		await proxiedProcess.start();

		const port = await proxiedProcess.getPort();

		await sleep(1000);

		const result = await fetch(`http://127.0.0.1:${port}/test`);

		expect(result.status).toBe(200);
		expect(await result.text()).toInclude('Path: /test');

		await proxiedProcess.stop();
	});
});
