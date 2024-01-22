import path from 'path';


// they are functions so we can easily mock them in tests
export const WEBSERVER_PATHS = {
	notary: () => path.join(process.cwd(), './bin/notary-webserver'),
	prover: () => path.join(process.cwd(), './bin/prover-webserver'),
};
