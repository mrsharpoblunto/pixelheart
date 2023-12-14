import chalk from "chalk";
import WebSocket from "ws";
import watcher from "@parcel/watcher";
import path from "path";
import { Worker } from "worker_threads";

export class EditorServerHost {
  wss: WebSocket.Server;
  requestBuffer: Array<Object>;
  editor: Worker | null;

  constructor(port: number, srcPath: string) {
    this.wss = new WebSocket.Server({ port });
    this.wss.on("listening", () => {
      console.log(chalk.dim("[Editor]"), `Listening on port ${port}`);
    });
    this.requestBuffer = new Array<Object>();
    this.wss.on("connection", (ws) => {
      ws.on("message", (message) => {
        const editorMessage = JSON.parse(message.toString());
        if (this.editor) {
          this.editor.postMessage(editorMessage);
        } else {
          this.requestBuffer.push(editorMessage);
        }
      });
    });
    watcher.subscribe(
      srcPath,
      async (_err, _events) => {
        console.log(chalk.dim("[Editor]"), "Restarting...");
        this.editor?.postMessage({ type: "RESTART" });
        this.editor = null;
      },
      {
        ignore: ["client/**"],
      }
    );
    this.editor = null;
    this.createEditor();
  }

  createEditor() {
    this.editor = new Worker(path.join(__dirname, "editor-server-worker.ts"), {
      eval: false,
      workerData: null,
      execArgv: ["-r", "ts-node/register"],
    });

    this.editor.on("error", (error: any) => {
      console.log(chalk.dim("[Editor]"), `Error - ${error.stack}`);
    });

    this.editor.on("exit", (code: number) => {
      console.log(chalk.dim("[Editor]"), `Closed (${code}).`);
      this.createEditor();
    });

    this.editor.on("message", (message: any) => {
      this.broadcast(message);
    });

    for (const request of this.requestBuffer) {
      this.editor.postMessage(request);
    }
    this.requestBuffer.length = 0;
  }

  broadcast<T extends { type: string }>(event: T) {
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        console.log(
          chalk.dim("[Editor]"),
          `Sending ${chalk.green(event.type)} event.`
        );
        client.send(JSON.stringify(event));
      }
    });
  }
}
