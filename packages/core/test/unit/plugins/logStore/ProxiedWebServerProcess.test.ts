import fetch from 'node-fetch';

import { ProxiedWebServerProcess } from '../../../../src/plugins/logStore/http-proxy/ProxiedWebServerProcess';
import { ReverseProxy } from '../../../../src/plugins/logStore/http-proxy/ReverseProxy';
import { sleep, TEST_WEBSERVER_PATH } from '../../../utils';

describe('ProxiedWebServerProcess', () => {
	it('should execute the test script', async () => {
		process.env.LOG_LEVEL = 'debug';
		const proxiedProcess = new ProxiedWebServerProcess(
			'test',
			TEST_WEBSERVER_PATH,
			({ port }) => ['--port', port.toString()],
			'/test',
			{
				registerProxyPath: (path1) => {},
			} as ReverseProxy
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
