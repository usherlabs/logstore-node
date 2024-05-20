import { PassThrough, pipeline } from 'stream';

import { Chunker } from '../../../../src/plugins/logStore/Chunker';

describe('Chunker', () => {
	let chunkerCallback: jest.Mock;
	let sourceStreamMock: PassThrough;
	let chunker: Chunker<string>;

	beforeEach(() => {
		chunkerCallback = jest.fn().mockImplementation();
		sourceStreamMock = new PassThrough({ objectMode: true });
	});

	describe('chunk items limit: 2', () => {
		beforeEach(() => {
			chunker = new Chunker(chunkerCallback, { itemsLimit: 2 });
		});

		test('calls the callback with an empty final chunk', (done) => {
			pipeline(sourceStreamMock, chunker, (err) => {
				if (err) {
					done(err);
					return;
				}

				try {
					expect(chunkerCallback).toHaveBeenNthCalledWith(1, [], true);
					done();
				} catch (error) {
					done(error);
				}
			});

			sourceStreamMock.push(null);
		});

		test('calls the callback with a final chunk of 1 element', (done) => {
			pipeline(sourceStreamMock, chunker, (err) => {
				if (err) {
					done(err);
					return;
				}

				try {
					expect(chunkerCallback).toHaveBeenNthCalledWith(
						1,
						['element-00'],
						true
					);
					done();
				} catch (error) {
					done(error);
				}
			});
			sourceStreamMock.push('element-00');
			sourceStreamMock.push(null);
		});

		test('calls the callback with a chunk of 2 elements followed by an empty final chunk', (done) => {
			pipeline(sourceStreamMock, chunker, (err) => {
				if (err) {
					done(err);
					return;
				}

				try {
					expect(chunkerCallback).toHaveBeenNthCalledWith(
						1,
						['element-00', 'element-01'],
						false
					);
					expect(chunkerCallback).toHaveBeenNthCalledWith(2, [], true);
					done();
				} catch (error) {
					done(error);
				}
			});

			sourceStreamMock.push('element-00');
			sourceStreamMock.push('element-01');
			sourceStreamMock.push(null);
		});

		test('calls the callback with a chunk of 2 elements followed by a final chunk of 1 element', (done) => {
			pipeline(sourceStreamMock, chunker, (err) => {
				if (err) {
					done(err);
					return;
				}

				try {
					expect(chunkerCallback).toHaveBeenNthCalledWith(
						1,
						['element-00', 'element-01'],
						false
					);
					expect(chunkerCallback).toHaveBeenNthCalledWith(
						2,
						['element-02'],
						true
					);
					done();
				} catch (error) {
					done(error);
				}
			});

			sourceStreamMock.push('element-00');
			sourceStreamMock.push('element-01');
			sourceStreamMock.push('element-02');
			sourceStreamMock.push(null);
		});
	});

	describe('chunk bytes limit: 20', () => {
		beforeEach(() => {
			chunker = new Chunker(chunkerCallback, { bytesLimit: 20 });
		});

		test('calls the callback with a chunk of 2 elements followed by an empty final chunk', (done) => {
			pipeline(sourceStreamMock, chunker, (err) => {
				if (err) {
					done(err);
					return;
				}

				try {
					expect(chunkerCallback).toHaveBeenNthCalledWith(
						1,
						['element-00', 'element-01'],
						false
					);
					expect(chunkerCallback).toHaveBeenNthCalledWith(
						2,
						['element-02', 'element-03'],
						false
					);
					expect(chunkerCallback).toHaveBeenNthCalledWith(3, [], true);
					done();
				} catch (error) {
					done(error);
				}
			});

			sourceStreamMock.push('element-00');
			sourceStreamMock.push('element-01');
			sourceStreamMock.push('element-02');
			sourceStreamMock.push('element-03');
			sourceStreamMock.push(null);
		});
	});

	// TODO: Cover the cases with error handling
});
