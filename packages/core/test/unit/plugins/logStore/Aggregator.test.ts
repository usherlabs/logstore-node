import { QueryRequest, QueryType } from '@logsn/protocol';
import { MessageRef } from '@streamr/protocol';
import { convertStreamMessageToBytes } from '@streamr/trackerless-network';
import { toEthereumAddress } from '@streamr/utils';
import { PassThrough, pipeline } from 'stream';

import { DatabaseAdapter } from '../../../../src/plugins/logStore/database/DatabaseAdapter';
import { Aggregator } from '../../../../src/plugins/logStore/network/Aggregator';
import {
	createQueryPropagate,
	createQueryResponse,
	mockStreamMessageRange,
	REQUEST_ID,
	STREAM_ID,
	STREAM_PARTITION,
} from './test-utils';

describe('Aggregator aggregates messages from', () => {
	const queryRequest = new QueryRequest({
		requestId: REQUEST_ID,
		consumerId: 'consumerId',
		streamId: STREAM_ID,
		partition: STREAM_PARTITION,
		queryOptions: {
			queryType: QueryType.Range,
			from: new MessageRef(100200300, 0),
			to: new MessageRef(100200301, 0),
		},
	});

	let data: Uint8Array[];
	let result: Uint8Array[];

	let responseChunkCallbackMock: jest.Mock;

	let queryStreamMock1: PassThrough;
	let queryStreamMock2: PassThrough;
	let queryStreamMock3: PassThrough;
	let queryStreamMock4: PassThrough;
	let responseStreamMock: PassThrough;
	let database: DatabaseAdapter;
	let aggregator: Aggregator;

	beforeEach(() => {
		data = Array.from(mockStreamMessageRange(100200300, 100200309)).map((m) =>
			convertStreamMessageToBytes(m)
		);
		result = [];

		responseChunkCallbackMock = jest.fn().mockImplementation();
		queryStreamMock1 = new PassThrough({ objectMode: true });
		queryStreamMock2 = new PassThrough({ objectMode: true });
		queryStreamMock3 = new PassThrough({ objectMode: true });
		queryStreamMock4 = new PassThrough({ objectMode: true });
		responseStreamMock = new PassThrough({ objectMode: true }).on(
			'data',
			(responseData) => {
				result.push(responseData);
			}
		);

		database = jest.mocked<DatabaseAdapter>(
			{
				queryRange: jest
					.fn()
					// .mockImplementation(() => queryStreamMock1),
					.mockImplementationOnce(() => queryStreamMock1)
					.mockImplementationOnce(() => queryStreamMock2)
					.mockImplementationOnce(() => queryStreamMock3)
					.mockImplementationOnce(() => queryStreamMock4),
				store: jest.fn().mockImplementation(),
			} as unknown as DatabaseAdapter,
			{ shallow: true }
		);
	});

	describe('single primary node', () => {
		beforeEach(() => {
			aggregator = new Aggregator(
				database,
				queryRequest,
				[],
				responseChunkCallbackMock
			);
		});

		test('if there is no data for the query', (done) => {
			pipeline(aggregator, responseStreamMock, (err) => {
				try {
					expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
					expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
						1,
						[],
						true
					);

					expect(result).toEqual([]);

					done(err);
				} catch (e) {
					done(e);
				}
			});

			queryStreamMock1.push(null);
		});

		test('if there is data for the query', (done) => {
			pipeline(aggregator, responseStreamMock, (err) => {
				try {
					expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
					expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
						1,
						[data[0]],
						true
					);

					expect(result).toEqual([data[0]]);

					done(err);
				} catch (e) {
					done(e);
				}
			});

			setImmediate(() => {
				queryStreamMock1.push(data[0]);
				queryStreamMock1.push(null);

				queryStreamMock2.push(data[0]);
				queryStreamMock2.push(null);
			});
		});
	});

	describe('a network of a primary node and 1 foreign node', () => {
		const foreignNode1 = toEthereumAddress(
			'0xffffffffffffffffffffffffffffffff00000001'
		);

		beforeEach(() => {
			aggregator = new Aggregator(
				database,
				queryRequest,
				[foreignNode1],
				responseChunkCallbackMock
			);
		});

		test('if there is no data for the query', (done) => {
			pipeline(aggregator, responseStreamMock, (err) => {
				try {
					expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
					expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
						1,
						[],
						true
					);

					done(err);
				} catch (e) {
					done(e);
				}
			});

			queryStreamMock1.push(null);

			aggregator.onForeignResponse(
				foreignNode1,
				createQueryResponse(REQUEST_ID, [], true)
			);
		});

		describe('if the primary node has the same data as the foreign node', () => {
			test.skip('and the foreign node responds with 1 response', (done) => {
				pipeline(aggregator, responseStreamMock, (err) => {
					try {
						expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
						expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
							1,
							[data[0], data[1], data[2]],
							true
						);

						expect(result).toEqual([data[0], data[1], data[2]]);

						done(err);
					} catch (e) {
						done(e);
					}
				});

				queryStreamMock1.push(data[0]);
				queryStreamMock1.push(data[1]);
				queryStreamMock1.push(data[2]);
				queryStreamMock1.push(null);

				queryStreamMock2.push(data[0]);
				queryStreamMock2.push(data[1]);
				queryStreamMock2.push(data[2]);
				queryStreamMock2.push(null);

				aggregator.onForeignResponse(
					foreignNode1,
					createQueryResponse(REQUEST_ID, [data[0], data[1], data[2]], true)
				);
			});

			test.skip('and the foreign node responds with 2 responses', (done) => {
				pipeline(aggregator, responseStreamMock, (err) => {
					try {
						expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
						expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
							1,
							[data[0], data[1], data[2]],
							true
						);

						expect(result).toEqual([data[0], data[1], data[2]]);

						done(err);
					} catch (e) {
						done(e);
					}
				});

				queryStreamMock1.push(data[0]);
				queryStreamMock1.push(data[1]);
				queryStreamMock1.push(data[2]);
				queryStreamMock1.push(null);

				queryStreamMock2.push(data[0]);
				queryStreamMock2.push(data[1]);
				queryStreamMock2.push(null);

				queryStreamMock3.push(data[2]);
				queryStreamMock3.push(null);

				aggregator.onForeignResponse(
					foreignNode1,
					createQueryResponse(REQUEST_ID, [data[0], data[1]], false)
				);
				aggregator.onForeignResponse(
					foreignNode1,
					createQueryResponse(REQUEST_ID, [data[2]], true)
				);
			});

			test('and the foreign node responds with 3 responses', (done) => {
				pipeline(aggregator, responseStreamMock, (err) => {
					try {
						expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
						expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
							1,
							[data[0], data[1], data[2]],
							true
						);

						expect(result).toEqual([data[0], data[1], data[2]]);

						done(err);
					} catch (e) {
						done(e);
					}
				});

				queryStreamMock1.push(data[0]);
				queryStreamMock1.push(data[1]);
				queryStreamMock1.push(data[2]);
				queryStreamMock1.push(null);

				queryStreamMock2.push(data[0]);
				queryStreamMock2.push(null);

				queryStreamMock3.push(data[1]);
				queryStreamMock3.push(null);

				queryStreamMock4.push(data[2]);
				queryStreamMock4.push(null);

				aggregator.onForeignResponse(
					foreignNode1,
					createQueryResponse(REQUEST_ID, [data[0]], false)
				);
				aggregator.onForeignResponse(
					foreignNode1,
					createQueryResponse(REQUEST_ID, [data[1]], false)
				);
				aggregator.onForeignResponse(
					foreignNode1,
					createQueryResponse(REQUEST_ID, [data[2]], true)
				);
			});
		});

		test('if the primary node has data for the query but the foreign node does not', (done) => {
			pipeline(aggregator, responseStreamMock, (err) => {
				try {
					expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
					expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
						1,
						[data[0]],
						true
					);

					expect(result).toEqual([data[0]]);

					done(err);
				} catch (e) {
					done(e);
				}
			});

			queryStreamMock1.push(data[0]);
			queryStreamMock1.push(null);

			queryStreamMock2.push(data[0]);
			queryStreamMock2.push(null);

			aggregator.onForeignResponse(
				foreignNode1,
				createQueryResponse(REQUEST_ID, [], true)
			);
		});

		describe('if the primary node does not have data for the query', () => {
			test('and the foreign node has 1 message to propagate', (done) => {
				pipeline(aggregator, responseStreamMock, (err) => {
					try {
						expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
						expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
							1,
							[],
							true
						);

						expect(result).toEqual([data[0]]);

						done(err);
					} catch (e) {
						done(e);
					}
				});

				queryStreamMock1.push(null);

				queryStreamMock2.push(data[0]);
				queryStreamMock2.push(null);

				aggregator.onForeignResponse(
					foreignNode1,
					createQueryResponse(REQUEST_ID, [data[0]], true)
				);
				aggregator.onPropagation(
					foreignNode1,
					createQueryPropagate(REQUEST_ID, [data[0]])
				);
			});

			describe('and the foreign node has 2 message to propagate', () => {
				test('the foreign node propagates with 1 message', (done) => {
					pipeline(aggregator, responseStreamMock, (err) => {
						try {
							expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
							expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
								1,
								[],
								true
							);

							expect(result).toEqual([data[0], data[1]]);

							done(err);
						} catch (e) {
							done(e);
						}
					});

					queryStreamMock1.push(null);

					queryStreamMock2.push(data[0]);
					queryStreamMock2.push(data[1]);
					queryStreamMock2.push(null);

					aggregator.onForeignResponse(
						foreignNode1,
						createQueryResponse(REQUEST_ID, [data[0], data[1]], true)
					);
					aggregator.onPropagation(
						foreignNode1,
						createQueryPropagate(REQUEST_ID, [data[0], data[1]])
					);
				});

				test('the foreign node propagates with 2 messages', (done) => {
					pipeline(aggregator, responseStreamMock, (err) => {
						try {
							expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
							expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
								1,
								[],
								true
							);

							expect(result).toEqual([data[0], data[1]]);

							done(err);
						} catch (e) {
							done(e);
						}
					});

					queryStreamMock1.push(null);

					queryStreamMock2.push(data[0]);
					queryStreamMock2.push(data[1]);
					queryStreamMock2.push(null);

					aggregator.onForeignResponse(
						foreignNode1,
						createQueryResponse(REQUEST_ID, [data[0], data[1]], true)
					);
					aggregator.onPropagation(
						foreignNode1,
						createQueryPropagate(REQUEST_ID, [data[0]])
					);
					aggregator.onPropagation(
						foreignNode1,
						createQueryPropagate(REQUEST_ID, [data[1]])
					);
				});
			});
		});
	});

	describe('a network of a primary node and 2 foreign nodes', () => {
		const foreignNode1 = toEthereumAddress(
			'0xffffffffffffffffffffffffffffffff00000001'
		);
		const foreignNode2 = toEthereumAddress(
			'0xffffffffffffffffffffffffffffffff00000002'
		);

		beforeEach(() => {
			aggregator = new Aggregator(
				database,
				queryRequest,
				[foreignNode1, foreignNode2],
				responseChunkCallbackMock
			);
		});

		test('if there is no data for the query', (done) => {
			pipeline(aggregator, responseStreamMock, (err) => {
				try {
					expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
					expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
						1,
						[],
						true
					);

					expect(result).toEqual([]);

					done(err);
				} catch (e) {
					done(e);
				}
			});

			queryStreamMock1.push(null);

			aggregator.onForeignResponse(
				foreignNode1,
				createQueryResponse(REQUEST_ID, [], true)
			);
			aggregator.onForeignResponse(
				foreignNode2,
				createQueryResponse(REQUEST_ID, [], true)
			);
		});

		test('if the primary node has the same data as both foreign nodes', (done) => {
			pipeline(aggregator, responseStreamMock, (err) => {
				try {
					expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
					expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
						1,
						[data[0]],
						true
					);

					expect(result).toEqual([data[0]]);

					done(err);
				} catch (e) {
					done(e);
				}
			});

			queryStreamMock1.push(data[0]);
			queryStreamMock1.push(null);

			queryStreamMock2.push(data[0]);
			queryStreamMock2.push(null);

			aggregator.onForeignResponse(
				foreignNode1,
				createQueryResponse(REQUEST_ID, [data[0]], true)
			);
			aggregator.onForeignResponse(
				foreignNode2,
				createQueryResponse(REQUEST_ID, [data[0]], true)
			);
		});

		test.skip('if the primary node has all the data for the query but the foreign nodes have it partially', (done) => {
			pipeline(aggregator, responseStreamMock, (err) => {
				try {
					expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
					expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
						1,
						[data[0], data[1], data[2]],
						true
					);

					expect(result).toEqual([data[0], data[1], data[2]]);

					done(err);
				} catch (e) {
					done(e);
				}
			});

			queryStreamMock1.push(data[0]);
			queryStreamMock1.push(data[1]);
			queryStreamMock1.push(data[2]);
			queryStreamMock1.push(null);

			queryStreamMock2.push(data[0]);
			queryStreamMock2.push(data[1]);
			queryStreamMock2.push(null);

			queryStreamMock3.push(data[2]);
			queryStreamMock3.push(null);

			aggregator.onForeignResponse(
				foreignNode1,
				createQueryResponse(REQUEST_ID, [data[1]], true)
			);
			aggregator.onForeignResponse(
				foreignNode2,
				createQueryResponse(REQUEST_ID, [data[2]], true)
			);
		});

		describe('if the primary node does not have data for the query', () => {
			test('and the foreign nodes have 1 message to propagate', (done) => {
				pipeline(aggregator, responseStreamMock, (err) => {
					try {
						expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
						expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
							1,
							[],
							true
						);

						expect(result).toEqual([data[0]]);

						done(err);
					} catch (e) {
						done(e);
					}
				});

				queryStreamMock1.push(null);

				queryStreamMock2.push(data[0]);
				queryStreamMock2.push(null);

				aggregator.onForeignResponse(
					foreignNode1,
					createQueryResponse(REQUEST_ID, [data[0]], true)
				);
				aggregator.onForeignResponse(
					foreignNode2,
					createQueryResponse(REQUEST_ID, [data[0]], true)
				);
				aggregator.onPropagation(
					foreignNode1,
					createQueryPropagate(REQUEST_ID, [data[0]])
				);
				aggregator.onPropagation(
					foreignNode2,
					createQueryPropagate(REQUEST_ID, [data[0]])
				);
			});

			describe('and the foreign nodes have 2 identical messages to propagate', () => {
				test('the foreign nodes propagate with 1 message', (done) => {
					pipeline(aggregator, responseStreamMock, (err) => {
						try {
							expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
							expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
								1,
								[],
								true
							);

							expect(result).toEqual([data[0], data[1]]);

							done(err);
						} catch (e) {
							done(e);
						}
					});

					queryStreamMock1.push(null);

					queryStreamMock2.push(data[0]);
					queryStreamMock2.push(data[1]);
					queryStreamMock2.push(null);

					aggregator.onForeignResponse(
						foreignNode1,
						createQueryResponse(REQUEST_ID, [data[0], data[1]], true)
					);
					aggregator.onForeignResponse(
						foreignNode2,
						createQueryResponse(REQUEST_ID, [data[0], data[1]], true)
					);
					aggregator.onPropagation(
						foreignNode1,
						createQueryPropagate(REQUEST_ID, [data[0], data[1]])
					);
					aggregator.onPropagation(
						foreignNode2,
						createQueryPropagate(REQUEST_ID, [data[0], data[1]])
					);
				});

				test('the foreign nodes propagate with 2 messages', (done) => {
					pipeline(aggregator, responseStreamMock, (err) => {
						try {
							expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
							expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
								1,
								[],
								true
							);

							expect(result).toEqual([data[0], data[1]]);

							done(err);
						} catch (e) {
							done(e);
						}
					});

					queryStreamMock1.push(null);

					queryStreamMock2.push(data[0]);
					queryStreamMock2.push(data[1]);
					queryStreamMock2.push(null);

					aggregator.onForeignResponse(
						foreignNode1,
						createQueryResponse(REQUEST_ID, [data[0], data[1]], true)
					);
					aggregator.onForeignResponse(
						foreignNode2,
						createQueryResponse(REQUEST_ID, [data[0], data[1]], true)
					);
					aggregator.onPropagation(
						foreignNode1,
						createQueryPropagate(REQUEST_ID, [data[0]])
					);
					aggregator.onPropagation(
						foreignNode1,
						createQueryPropagate(REQUEST_ID, [data[1]])
					);
					aggregator.onPropagation(
						foreignNode2,
						createQueryPropagate(REQUEST_ID, [data[0]])
					);
					aggregator.onPropagation(
						foreignNode2,
						createQueryPropagate(REQUEST_ID, [data[1]])
					);
				});
			});

			describe('and the foreign nodes have 1 identical message and 2 different messages to propagate', () => {
				test('the foreign nodes propagate with 1 message', (done) => {
					pipeline(aggregator, responseStreamMock, (err) => {
						try {
							expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
							expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
								1,
								[],
								true
							);

							expect(result).toEqual([data[0], data[1], data[2]]);

							done(err);
						} catch (e) {
							done(e);
						}
					});

					queryStreamMock1.push(null);

					queryStreamMock2.push(data[0]);
					queryStreamMock2.push(data[1]);
					queryStreamMock2.push(data[2]);
					queryStreamMock2.push(null);

					aggregator.onForeignResponse(
						foreignNode1,
						createQueryResponse(REQUEST_ID, [data[0], data[1]], true)
					);
					aggregator.onForeignResponse(
						foreignNode2,
						createQueryResponse(REQUEST_ID, [data[0], data[2]], true)
					);
					aggregator.onPropagation(
						foreignNode1,
						createQueryPropagate(REQUEST_ID, [data[0], data[1]])
					);
					aggregator.onPropagation(
						foreignNode2,
						createQueryPropagate(REQUEST_ID, [data[0], data[2]])
					);
				});

				test('the foreign nodes propagate with 2 messages', (done) => {
					pipeline(aggregator, responseStreamMock, (err) => {
						try {
							expect(responseChunkCallbackMock).toHaveBeenCalledTimes(1);
							expect(responseChunkCallbackMock).toHaveBeenNthCalledWith(
								1,
								[],
								true
							);

							expect(result).toEqual([data[0], data[1], data[2]]);

							done(err);
						} catch (e) {
							done(e);
						}
					});

					queryStreamMock1.push(null);

					queryStreamMock2.push(data[0]);
					queryStreamMock2.push(data[1]);
					queryStreamMock2.push(data[2]);
					queryStreamMock2.push(null);

					aggregator.onForeignResponse(
						foreignNode1,
						createQueryResponse(REQUEST_ID, [data[0], data[1]], true)
					);
					aggregator.onForeignResponse(
						foreignNode2,
						createQueryResponse(REQUEST_ID, [data[0], data[2]], true)
					);
					aggregator.onPropagation(
						foreignNode1,
						createQueryPropagate(REQUEST_ID, [data[0]])
					);
					aggregator.onPropagation(
						foreignNode1,
						createQueryPropagate(REQUEST_ID, [data[1]])
					);
					aggregator.onPropagation(
						foreignNode2,
						createQueryPropagate(REQUEST_ID, [data[0]])
					);
					aggregator.onPropagation(
						foreignNode2,
						createQueryPropagate(REQUEST_ID, [data[2]])
					);
				});
			});
		});
	});
});
