import chalk from 'chalk';
import { BuildLogger } from './plugin.js';

class BuildError extends Error {
  scope: string;

  constructor(scope: string, message: string) {
    super(message);
    this.scope = scope;
    this.name = 'BuildError';
  }
};

export class Logger implements BuildLogger {
  #throwOnError: boolean;
  errorCount: number = 0;

  constructor(throwOnError: boolean) {
    this.#throwOnError = throwOnError;
  }

  log(scope: string, message?: string) {
    console.log.apply(console, [
      chalk.dim(`[${scope}]`),
      ...(message ? [message] : [])
    ]);
  }

  warn(scope: string, message: string) {
    this.log(scope, chalk.yellow(message));
  }

  error(scope: string, message: string) {
    if (!this.#throwOnError) {
      throw new BuildError(scope,message);
    } else {
      this.errorCount++;
      this.log(scope, chalk.red(message));
    }
  }
}

