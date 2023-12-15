export type LogStoreNodeProgramModule = {
	createProgram(rpcUrl: string): LogStoreNodeProgram;
};

export abstract class LogStoreNodeProgram {
	protected readonly rpcUrl: string;

	constructor(rpcUrl: string) {
		this.rpcUrl = rpcUrl;
	}

	public abstract process(args: unknown): Promise<unknown>;
}
