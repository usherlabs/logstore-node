import { Logger } from '@streamr/utils';
import fs from 'fs';
import { spawn } from 'node:child_process';
import { Observable, Subject } from 'rxjs';

import tempfile from '../../../utils/tempfile';

const logger = new Logger(module);

export const tmpFilePathFromContent = (content: string) =>
	new Observable<string>((observer) => {
		let tmpFilePath: string | undefined;
		tempfile().then((path) => {
			tmpFilePath = path;
			fs.writeFile(tmpFilePath, content, (err) => {
				if (err) {
					observer.error(err);
					return;
				}
				observer.next(path);
			});
		});

		return () => {
			if (tmpFilePath) {
				fs.unlinkSync(tmpFilePath);
			}
		};
	});

export const fromProcess = ({
	name,
	cmd,
	args,
}: {
	name: string;
	cmd: string;
	args: string[];
}) =>
	new Observable<{
		data: Observable<string>;
		error: Observable<string>;
	}>((observer) => {
		const childProcess = spawn(cmd, args);
		const data$ = new Subject<string>();
		const error$ = new Subject<string>();

		childProcess.stdout.on('data', (data) => {
			data$.next(data.toString());
		});

		childProcess.stderr.on('error', (data) => {
			error$.next(data.toString());
		});

		childProcess.on('close', (code) => {
			logger.info(`${name} exited with code ${code}`);

			observer.complete();
		});

		observer.next({
			data: data$,
			error: error$,
		});

		return () => {
			childProcess.kill();
		};
	});

const alreadyUsedPorts = new Set<number>();
export const getNextAvailablePort = (basePort: number): number => {
	const port = basePort + 1;
	if (alreadyUsedPorts.has(port)) {
		return getNextAvailablePort(port);
	}

	alreadyUsedPorts.add(port);
	return port;
};
