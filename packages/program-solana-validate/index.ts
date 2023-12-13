import { LogStoreNodeProgram } from '@logsn/program';

import { Program } from './program';

export function createProgram(rpcUrl: string): LogStoreNodeProgram {
	return new Program(rpcUrl);
}
