/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
	preset: 'ts-jest/presets/js-with-ts',
	setupFiles: ['dotenv/config'],
	testEnvironment: 'node',
	clearMocks: true,
	// can't use prettier 3 with jest
	prettierPath: require.resolve('prettier-2'),
	globals: {
		'ts-jest': {
			tsconfig: 'tsconfig.jest.json',
		},
	},
	setupFilesAfterEnv: ['jest-extended/all', 'dotenv/config'],
};
