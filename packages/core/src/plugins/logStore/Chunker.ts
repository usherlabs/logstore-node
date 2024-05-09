import { Transform, TransformCallback } from 'stream';

const ITEMS_LIMIT = 5000;
const BYTES_LIMIT = 500 * 1024;

export type ChunkerCallback<T> = (chunk: T[], isFinal: boolean) => void;

interface ChunkerOptions {
	itemsLimit?: number;
	bytesLimit?: number;
}

export class Chunker<T> extends Transform {
	private readonly lengthLimit: number;
	private readonly sizeLimit: number;
	private readonly chunkCallback: ChunkerCallback<T>;
	private readonly items: T[] = [];
	private chunkSize: number = 0;

	constructor(
		chunkCallback: ChunkerCallback<T>,
		{ itemsLimit = ITEMS_LIMIT, bytesLimit = BYTES_LIMIT }: ChunkerOptions = {}
	) {
		super({ objectMode: true });

		this.lengthLimit = itemsLimit;
		this.sizeLimit = bytesLimit;
		this.chunkCallback = chunkCallback;

		this.once('finish', () => {
			this.finishCunkIfReady(true);
		});
	}

	override _transform(
		data: T,
		_encoding: BufferEncoding,
		callback: TransformCallback
	): void {
		this.items.push(data);
		this.chunkSize += (data as string).length;

		try {
			this.finishCunkIfReady(false);
		} catch (err) {
			callback(err as Error);
		}
		callback();
	}

	private finishCunkIfReady(isFinal: boolean) {
		if (
			isFinal ||
			this.items.length >= this.lengthLimit ||
			this.chunkSize >= this.sizeLimit
		) {
			this.chunkCallback(this.items.splice(0), isFinal);
			this.chunkSize = 0;
		}
	}
}
