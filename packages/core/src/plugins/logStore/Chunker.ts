import { Transform, TransformCallback } from 'stream';

const ITEMS_LIMIT = 5000;
const BYTES_LIMIT = 500 * 1024;

export type ChunkerCallback<T> = (chunk: T[], isFinal: boolean) => void;

interface ChunkerOptions {
	itemsLimit?: number;
	bytesLimit?: number;
}

export class Chunker<T> extends Transform {
	private readonly itemsLimit: number;
	private readonly bytesLimit: number;
	private readonly chunkCallback: ChunkerCallback<T>;
	private readonly items: T[] = [];
	private chunkBytes: number = 0;

	constructor(
		chunkCallback: ChunkerCallback<T>,
		{ itemsLimit = ITEMS_LIMIT, bytesLimit = BYTES_LIMIT }: ChunkerOptions = {}
	) {
		super({ objectMode: true });

		this.itemsLimit = itemsLimit;
		this.bytesLimit = bytesLimit;
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
		this.chunkBytes += (data as string).length;

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
			this.items.length >= this.itemsLimit ||
			this.chunkBytes >= this.bytesLimit
		) {
			this.chunkCallback(this.items.splice(0), isFinal);
			this.chunkBytes = 0;
		}
	}
}
