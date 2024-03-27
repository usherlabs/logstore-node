import micromatch from 'micromatch';

/**
 * Check if the original string matches any of the globs
 */
export const globsMatch = (
	originalStr: string,
	...globs: string[]
): boolean => {
	return globs.some((glob) => micromatch.isMatch(originalStr, glob));
};
