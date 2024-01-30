import path from 'path';

import { rootPath } from '../../../utils/paths';


// they are functions so we can easily mock them in tests
export const WEBSERVER_PATHS = {
	notary: () => path.join(rootPath, './bin/notary-webserver'),
	prover: () => path.join(rootPath, './bin/prover-webserver'),
};
