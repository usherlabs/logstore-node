import { BrokerProgram } from '@logsn/program';

import { Program } from './program';

export function createProgram(rpcUrl: string): BrokerProgram {
	return new Program(rpcUrl);
}
