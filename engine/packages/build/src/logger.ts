import chalk from 'chalk';
import { BuildLogger } from './plugin.js';

export class Logger implements BuildLogger {
  #scopes: Array<string>;
  #throwOnError: boolean;
  errorCount: number = 0;

  constructor(throwOnError: boolean) {
    this.#scopes = [];
    this.#throwOnError = throwOnError;
  }

  push(scope: string) { this.#scopes.push(scope); }

  pop() {
    if (this.#scopes.length > 0) {
      this.#scopes.pop();
    }
  }

  log(message?: string) {
    console.log.apply(console, [
      ...(this.#scopes.length ? [`[${this.#scopes[this.#scopes.length - 1]}]`] : []),
      ...(message ? [message] : [])
    ]);
  }

  warn(message: string) {
    this.log(chalk.yellow(message));
  }

  error(message: string) {
    if (!this.#throwOnError) {
      throw new Error(message);
    } else {
      this.errorCount++;
      this.log(chalk.red(message));
    }
  }
}

