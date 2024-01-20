import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// we're not using the original repo, as it's not compatible with our testing environment (the files are only ESM)
export default async function tempfile(options: { extension?: string } = {}) {
	if (typeof options === 'string') {
		throw new TypeError(
			'You must now pass in the file extension as an object.'
		);
	}

	let { extension } = options;

	if (typeof extension === 'string') {
		extension = extension.startsWith('.') ? extension : `.${extension}`;
	}
	const tempDirectory = await fs.realpath(os.tmpdir());

	return path.join(tempDirectory, randomUUID() + (extension ?? ''));
}
