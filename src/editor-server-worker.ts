import chalk from "chalk";
import { parentPort } from "worker_threads";

import EditorServer from "../game/editor/server";
import { BaseActions } from "./api";

const log = (message: string) => {
  console.log(chalk.dim("[Editor]"), message);
};

const logError = (message: string) => {
  console.log(chalk.dim("[Editor]"), chalk.red(message));
};

if (parentPort) {
  log("Running.");

  const connection = {
    send: (message: any) => {
      parentPort!.postMessage(message);
    },
  };
  const server = new EditorServer();
  server.onConnect(connection).then(() => {
    parentPort!.on("message", async (message: any) => {
      const a = message as BaseActions;
      log(`Processing ${chalk.green(a.type)} action`);
      await server.onAction(a);
    });
  });
}
