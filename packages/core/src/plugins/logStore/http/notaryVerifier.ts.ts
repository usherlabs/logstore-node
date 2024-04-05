import { Signer } from 'ethers';
import { sha256 } from 'ethers/lib/utils';
import express, { Request, RequestHandler, Response } from 'express';

import { HttpServerEndpoint } from '../../../Plugin';
import { WEBSERVER_PATHS } from '../subprocess/constants';
import { executeProcess } from '../subprocess/utils';

const createHandler = (signer: Signer): RequestHandler => {
	return async (req: Request, res: Response) => {
		try {
			const { pubKey, data } = req.body;

			const httpRequestResponse: { data: string } = await executeProcess({
				name: 'verifier',
				cmd: WEBSERVER_PATHS.verifier(),
				args: [pubKey, data],
			});

			// hash and sign
			const messageHash = sha256(
				Buffer.from(httpRequestResponse.data, 'utf-8')
			);

			// sign this hash
			const signature = await signer.signMessage(messageHash);

			// return all three
			res.send({
				data: {
					httpPayload: httpRequestResponse.data,
					signature,
					messageHash,
					address: await signer.getAddress(),
				},
				error: null,
			});
		} catch (err) {
			res.json({ data: null, error: err.message });
		}
	};
};

export const createNotaryVerifyEndpoint = (
	signer: Signer
): HttpServerEndpoint => {
	return {
		path: '/verify',
		method: 'post',
		requestHandlers: [express.json(), createHandler(signer)],
	};
};
