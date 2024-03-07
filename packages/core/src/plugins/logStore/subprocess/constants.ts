import path from 'path';

import { projectRootDirectory } from '../../../utils/paths';

// they are functions so we can easily mock them in tests
export const WEBSERVER_PATHS = {
	notary: () => path.join(projectRootDirectory, './bin/notary'),
	prover: () => path.join(projectRootDirectory, './bin/prover'),
};
