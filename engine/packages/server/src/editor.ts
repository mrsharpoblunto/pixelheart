import chalk from "chalk";
import watcher from "@parcel/watcher";
import { EventEmitter } from "events";
import path from "path";
import { Worker, MessagePort } from "worker_threads";
import WebSocket from "ws";
import { EditorMutation, EditorConnection } from "@pixelheart/client";


export interface EditorServerContext {
  outputRoot: string;
  gameRoot: string;
  assetsRoot: string;
  generatedSrcRoot: string;
}

export class EditorServerConnection<
  Actions extends EditorMutation,
  Events extends EditorMutation
> implements EditorConnection<Actions, Events>
{
  #eventHandlers: Array<(event: Events) => void>;
  #parentPort: MessagePort;

  constructor(parentPort: MessagePort) {
    this.#eventHandlers = [];
    this.#parentPort = parentPort;

    this.#parentPort.on("message", async (message: any) => {
      const a = message as Events;
      for (const handler of this.#eventHandlers) {
        handler(a);
      }
    });
  }

  send(message: Actions) {
    this.#parentPort.postMessage(message);
  }

  onEvent(handler: (event: Events) => void) {
    this.#eventHandlers.push(handler);
  }
}

export class EditorServerHost extends EventEmitter {
  wss: WebSocket.Server;
  requestBuffer: Array<Object>;
  editor: Worker | null;
  #srcPath: string;
  #outputPath: string;

  constructor(port: number, srcPath: string, outputPath: string) {
    super();
    this.#srcPath = srcPath;
    this.#outputPath = outputPath;
    this.wss = new WebSocket.Server({ port });
    this.wss.on("listening", () => {
      console.log(chalk.dim("[editor]"), `Listening on port ${port}`);
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
      this.#srcPath,
      async (_err, _events) => {
        console.log(chalk.dim("[editor]"), "Restarting...");
        this.editor?.postMessage({ type: "RESTART" });
        this.editor = null;
      },
      {
        ignore: ["client/**"],
      }
    );
    this.editor = null;
    this.createEditor();

    this.on("event", (event: EditorMutation) => {
      this.wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          console.log(
            chalk.dim("[editor]"),
            `Sending ${chalk.green(event.type)} event.`
          );
          client.send(JSON.stringify(event));
        }
      });
    });
  }

  createEditor() {
    this.editor = new Worker(path.join(this.#srcPath, "index.ts"), {
      eval: false,
      workerData: null,
      execArgv: [
        "-r",
        "ts-node/register",
      ],
    });

    this.editor.on("error", (error: any) => {
      console.log(chalk.dim("[editor]"), `Error - ${error.stack || JSON.stringify(error)}`);
    });

    this.editor.on("exit", (code: number) => {
      console.log(chalk.dim("[editor]"), `Closed (${code}).`);
      this.createEditor();
    });

    this.editor.on("message", (message: any) => {
      this.emit("event", message);
    });

    this.editor.postMessage({ type: "INIT", outputRoot: this.#outputPath });
    for (const request of this.requestBuffer) {
      this.editor.postMessage(request);
    }
    this.requestBuffer.length = 0;
  }
}
