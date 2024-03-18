import express, { Request, RequestHandler, Response } from 'express';
import fs from 'fs';
import path from 'path';

import { HttpServerEndpoint } from '../../../Plugin';

const filePath = path.join(
	String(process.env.HOME),
	'.logstore',
	'notary',
	'fixture',
	'notary',
	'notary.pub'
);

const createHandler = (): RequestHandler => {
	return async (req: Request, res: Response) => {
		try {
			// load up the keys from memory
			const fileContent = fs.readFileSync(filePath, 'utf-8');
			res.json({ data: fileContent, errorr: null });
		} catch (err) {
			res.json({ data: null, error: err.message });
		}
	};
};

export const createNotaryPubKeyFetchEndpoint = (): HttpServerEndpoint => {
	return {
		path: '/notarypub',
		method: 'get',
		requestHandlers: [express.json(), createHandler()],
	};
};
