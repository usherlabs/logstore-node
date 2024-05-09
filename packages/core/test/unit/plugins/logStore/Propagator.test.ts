import { QueryRequest, QueryType } from '@logsn/protocol';
import { MessageRef } from '@streamr/protocol';
import { convertStreamMessageToBytes } from '@streamr/trackerless-network';
import { PassThrough } from 'stream';

import { DatabaseAdapter } from '../../../../src/plugins/logStore/database/DatabaseAdapter';
import { Propagator } from '../../../../src/plugins/logStore/network/Propagator';
import {
	createQueryResponse,
	mockStreamMessageRange,
	REQUEST_ID,
	STREAM_ID,
	STREAM_PARTITION,
} from './test-utils';

describe('Propagator', () => {
	const data = Array.from(mockStreamMessageRange(100200300, 100200303)).map(
		(m) => convertStreamMessageToBytes(m)
	);

	const queryRequest = new QueryRequest({
		requestId: REQUEST_ID,
		consumerId: 'consumerId',
		streamId: STREAM_ID,
		partition: STREAM_PARTITION,
		queryOptions: {
			queryType: QueryType.Range,
			from: new MessageRef(100200300, 0),
			to: new MessageRef(100200300, 0),
		},
	});

	let responseChunkCallbackMock: jest.Mock;
	let propagationChunkCallbackMock: jest.Mock;
	let queryStreamMock: PassThrough;
	let queryByMessageRefsStreamMock1: PassThrough;
	let queryByMessageRefsStreamMock2: PassThrough;
	let database: DatabaseAdapter;

	beforeEach(() => {
		responseChunkCallbackMock = jest.fn().mockImplementation();
		propagationChunkCallbackMock = jest.fn().mockImplementation();
		queryStreamMock = new PassThrough({ objectMode: true });
		queryByMessageRefsStreamMock1 = new PassThrough({ objectMode: true });
		queryByMessageRefsStreamMock2 = new PassThrough({ objectMode: true });

		database = jest.mocked<DatabaseAdapter>(
			{
				queryRange: jest.fn().mockImplementation(() => queryStreamMock),
				queryByMessageRefs: jest
					.fn()
					.mockImplementationOnce(() => queryByMessageRefsStreamMock1)
					.mockImplementationOnce(() => queryByMessageRefsStreamMock2),
			} as unknown as DatabaseAdapter,
			{ shallow: true }
		);
	});

	describe('storage has no data', () => {
		test('simple #1', (done) => {
			const propagator = new Propagator(
				database,
				queryRequest,
				responseChunkCallbackMock,
				propagationChunkCallbackMock,
				() => {
					expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
					expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
						1,
						[],
						true
					);

					expect(propagationChunkCallbackMock).toHaveBeenCalledTimes(1);
					expect(propagationChunkCallbackMock).toHaveBeenCalledWith([], true);

					done();
				}
			);

			propagator.onPrimaryResponse(createQueryResponse(REQUEST_ID, [], true));

			queryStreamMock.push(null);
		});

		test('simple #2', (done) => {
			const propagator = new Propagator(
				database,
				queryRequest,
				responseChunkCallbackMock,
				propagationChunkCallbackMock,
				() => {
					expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
					expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
						1,
						[data[0]],
						true
					);

					expect(propagationChunkCallbackMock).toHaveBeenCalledTimes(1);
					expect(propagationChunkCallbackMock).toHaveBeenCalledWith([], true);

					done();
				}
			);

			propagator.onPrimaryResponse(
				createQueryResponse(REQUEST_ID, [data[0]], true)
			);

			queryStreamMock.push(data[0]);
			queryStreamMock.push(null);
		});

		test('simple #5', (done) => {
			const propagator = new Propagator(
				database,
				queryRequest,
				responseChunkCallbackMock,
				propagationChunkCallbackMock,
				() => {
					expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
					expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
						1,
						[data[0], data[1]],
						true
					);

					expect(propagationChunkCallbackMock).toHaveBeenCalledTimes(1);
					expect(propagationChunkCallbackMock).toHaveBeenCalledWith([], true);

					done();
				}
			);

			propagator.onPrimaryResponse(
				createQueryResponse(REQUEST_ID, [data[0], data[1]], true)
			);

			queryStreamMock.push(data[0]);
			queryStreamMock.push(data[1]);
			queryStreamMock.push(null);
		});

		test('simple #6', (done) => {
			const propagator = new Propagator(
				database,
				queryRequest,
				responseChunkCallbackMock,
				propagationChunkCallbackMock,
				() => {
					expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
					expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
						1,
						[data[0]],
						true
					);

					expect(propagationChunkCallbackMock).toHaveBeenCalledTimes(1);
					expect(propagationChunkCallbackMock).toHaveBeenNthCalledWith(
						1,
						[data[0]],
						true
					);

					done();
				}
			);
			propagator.onPrimaryResponse(createQueryResponse(REQUEST_ID, [], true));

			queryStreamMock.push(data[0]);
			queryStreamMock.push(null);

			queryByMessageRefsStreamMock1.push(data[0]);
			queryByMessageRefsStreamMock1.push(null);
		});

		test('simple #7', (done) => {
			const propagator = new Propagator(
				database,
				queryRequest,
				responseChunkCallbackMock,
				propagationChunkCallbackMock,
				() => {
					expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
					expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
						1,
						[data[0], data[1]],
						true
					);

					expect(propagationChunkCallbackMock).toHaveBeenCalledTimes(1);
					expect(propagationChunkCallbackMock).toHaveBeenNthCalledWith(
						1,
						[data[0], data[1]],
						true
					);

					done();
				}
			);
			propagator.onPrimaryResponse(createQueryResponse(REQUEST_ID, [], true));

			queryStreamMock.push(data[0]);
			queryStreamMock.push(data[1]);
			queryStreamMock.push(null);

			queryByMessageRefsStreamMock1.push(data[0]);
			queryByMessageRefsStreamMock1.push(null);

			queryByMessageRefsStreamMock2.push(data[1]);
			queryByMessageRefsStreamMock2.push(null);
		});

		test('simple #4', (done) => {
			const propagator = new Propagator(
				database,
				queryRequest,
				responseChunkCallbackMock,
				propagationChunkCallbackMock,
				() => {
					expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
					expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
						1,
						[data[0], data[1]],
						true
					);

					expect(propagationChunkCallbackMock).toHaveBeenCalledTimes(1);
					expect(propagationChunkCallbackMock).toHaveBeenNthCalledWith(
						1,
						[data[1]],
						true
					);

					done();
				}
			);

			propagator.onPrimaryResponse(
				createQueryResponse(REQUEST_ID, [data[0]], true)
			);

			queryStreamMock.push(data[0]);
			queryStreamMock.push(data[1]);
			queryStreamMock.push(null);

			queryByMessageRefsStreamMock1.push(data[1]);
			queryByMessageRefsStreamMock1.push(null);
		});
	});
});
