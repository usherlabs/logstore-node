import fs from 'fs';
import path from 'path';

const getProjectRootDirectory = (actual = __dirname): string => {
	const parent = path.dirname(actual);
	if (parent === actual) {
		throw new Error('Could not find root path');
	}
	const hasNodeModules = fs.existsSync(path.join(parent, 'node_modules'));
	if (hasNodeModules) {
		return parent;
	}
	return getProjectRootDirectory(parent);
};
export const projectRootDirectory = getProjectRootDirectory();
