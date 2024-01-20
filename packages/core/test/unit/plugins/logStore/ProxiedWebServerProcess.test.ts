import fetch from 'node-fetch';
import path from 'path';

import { ReverseProxy } from '../../../../src/plugins/logStore/http-proxy/ReverseProxy';
import { ProxiedWebServerProcess } from '../../../../src/plugins/logStore/http-proxy/ProxiedWebServerProcess';
import { sleep } from '../../../utils';

describe('ProxiedWebServerProcess', () => {
	it('should execute the test script', async () => {
		process.env.LOG_LEVEL = 'debug';
		const proxiedProcess = new ProxiedWebServerProcess(
			'test',
			path.join(process.cwd(), './bin/test-webserver'),
			({ port }) => ['-p', port.toString()],
			'/test',
			{
				registerProxyPath: (path1) => {},
			} as ReverseProxy,
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
