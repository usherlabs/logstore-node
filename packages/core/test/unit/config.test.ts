import { overrideConfigToEnvVarsIfGiven } from '../../src/config/config';

describe('overrideConfigToEnvVarsIfGiven', () => {
	beforeEach(() => {
		const PREFIX = 'LOGSTORE__BROKER__';
		Object.keys(process.env).forEach((variableName: string) => {
			if (variableName.startsWith(PREFIX)) {
				delete process.env[variableName];
			}
		});
	});

	it('happy path', () => {
		const config = {
			client: {
				auth: {
					privateKey: 'will-be-overridden',
				},
			},
			plugins: {
				info: {},
			},
		};
		process.env.LOGSTORE__BROKER__CLIENT__AUTH__PRIVATE_KEY = '0x111';
		process.env.LOGSTORE__BROKER__CLIENT__NETWORK__TRACKERS_1__ID =
			'tracker1-id';
		process.env.LOGSTORE__BROKER__CLIENT__NETWORK__TRACKERS_1__HTTP =
			'tracker1-http';
		process.env.LOGSTORE__BROKER__CLIENT__NETWORK__TRACKERS_2__ID =
			'tracker2-id';
		process.env.LOGSTORE__BROKER__CLIENT__NETWORK__TRACKERS_2__HTTP =
			'tracker2-http';
		process.env.LOGSTORE__BROKER__CLIENT__NETWORK__TRACKER_PING_INTERVAL =
			'-0.5';
		process.env.LOGSTORE__BROKER__CLIENT__ORDER_MESSAGES = 'true';
		process.env.LOGSTORE__BROKER__CLIENT__GAP_FILL = 'false';
		process.env.LOGSTORE__BROKER__AUTHENTICATION__KEYS_1 = 'key-1';
		process.env.LOGSTORE__BROKER__AUTHENTICATION__KEYS_2 = 'key-2';
		process.env.LOGSTORE__BROKER__PLUGINS__BRUBECK_MINER__BENEFICIARY_ADDRESS =
			'0x222';
		process.env.LOGSTORE__BROKER__PLUGINS__BRUBECK_MINER__STUN_SERVER_HOST =
			'null';
		overrideConfigToEnvVarsIfGiven(config);
		expect(config).toEqual({
			client: {
				auth: {
					privateKey: '0x111',
				},
				network: {
					trackers: [
						{
							id: 'tracker1-id',
							http: 'tracker1-http',
						},
						{
							id: 'tracker2-id',
							http: 'tracker2-http',
						},
					],
					trackerPingInterval: -0.5,
				},
				orderMessages: true,
				gapFill: false,
			},
			authentication: {
				keys: ['key-1', 'key-2'],
			},
			plugins: {
				brubeckMiner: {
					beneficiaryAddress: '0x222',
					stunServerHost: null,
				},
				info: {},
			},
		});
	});

	it('empty variable', () => {
		process.env.LOGSTORE__BROKER__CLIENT__AUTH__PRIVATE_KEY = '';
		process.env.LOGSTORE__BROKER__PLUGINS__BRUBECK_MINER__BENEFICIARY_ADDRESS =
			'0x222';
		const config = {} as any;
		overrideConfigToEnvVarsIfGiven(config);
		expect(config).toEqual({
			plugins: {
				brubeckMiner: {
					beneficiaryAddress: '0x222',
				},
			},
		});
	});

	it('malformed variable', () => {
		expect(() => {
			process.env.LOGSTORE__BROKER__AUTHENTICATION__KEYS1 = 'key-1';
			overrideConfigToEnvVarsIfGiven({} as any);
		}).toThrow('LOGSTORE__BROKER__AUTHENTICATION__KEYS1');
	});
});
