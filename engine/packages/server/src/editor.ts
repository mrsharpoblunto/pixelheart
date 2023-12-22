import watcher from "@parcel/watcher";
import chalk from "chalk";
import { spawn } from "child_process";
import { EventEmitter } from "events";
import path from "path";
import url from "url";
import { WebSocket, WebSocketServer } from "ws";

import { EditorConnection, EditorMutation } from "@pixelheart/client";

const dirname = path.dirname(url.fileURLToPath(import.meta.url));

export class EditorServerConnection<
  Actions extends EditorMutation,
  Events extends EditorMutation
> implements EditorConnection<Actions, Events>
{
  #eventHandlers: Array<(event: Events) => void>;
  #socket: WebSocket;

  constructor() {
    this.#eventHandlers = [];
    this.#socket = new WebSocket(
      `ws://localhost:${process.env["PIXELHEART_SERVER_PORT"]}`
    );
    this.#socket.on("message", (e) => {
      for (const handler of this.#eventHandlers) {
        handler(JSON.parse(e.toString()) as Events);
      }
    });
    this.#socket.on("open", () => {
      this.send({ type: "EDITOR_CONNECTED" } as Actions);
    });
  }
  send(action: Actions) {
    this.#socket?.send(JSON.stringify(action));
  }
  onEvent(cb: (event: Events) => void) {
    this.#eventHandlers.push(cb);
  }
}

export class EditorServerHost extends EventEmitter {
  #wss: WebSocketServer;
  #requestBuffer: Array<EditorMutation>;
  #editorSocket: WebSocket | null;
  #srcPath: string;
  #outputPath: string;
  #port: number;

  constructor(port: number, srcPath: string, outputPath: string) {
    super();
    this.#port = port;
    this.#editorSocket = null;
    this.#srcPath = srcPath;
    this.#outputPath = outputPath;
    this.#wss = new WebSocketServer({ port });
    this.#wss.on("listening", () => {
      console.log(chalk.dim("[editor]"), `Listening on port ${port} `);
    });
    this.#requestBuffer = new Array<EditorMutation>();
    this.#wss.on("connection", (ws) => {
      ws.on("message", (message) => {
        const editorMessage = JSON.parse(message.toString()) as EditorMutation;
        // record which socket is the editor
        if (editorMessage.type === "EDITOR_CONNECTED") {
          this.#editorSocket = ws;
          if (
            this.#sendToEditor([
              {
                type: "INIT",
                outputRoot: this.#outputPath,
              },
              ...this.#requestBuffer,
            ])
          ) {
            this.#requestBuffer.length = 0;
          }
          return;
        }

        if (
          this.#editorSocket &&
          this.#editorSocket.readyState === WebSocket.OPEN
        ) {
          if (this.#editorSocket === ws) {
            // messages from the editor get broadcast to all clients
            this.emit("event", editorMessage);
          } else {
            // and messages from clients get sent to the editor
            this.#editorSocket.send(message);
          }
        } else {
          this.#requestBuffer.push(editorMessage);
        }
      });
    });

    // restart when the editor src changes
    watcher.subscribe(
      this.#srcPath,
      async (_err, _events) => {
        if (this.#sendToEditor([{ type: "RESTART" }])) {
          console.log(chalk.dim("[editor]"), "Reloading...");
          this.#editorSocket = null;
        }
      },
      {
        ignore: ["client/**"],
      }
    );

    this.createEditor();

    this.on("event", (event: EditorMutation) => {
      this.#broadcast(event);
    });
  }

  #sendToEditor<T extends EditorMutation>(events: Array<T>) {
    if (
      this.#editorSocket &&
      this.#editorSocket.readyState === WebSocket.OPEN
    ) {
      for (const event of events) {
        this.#editorSocket.send(JSON.stringify(event));
      }
      return true;
    }
    return false;
  }

  #broadcast(event: EditorMutation) {
    this.#wss.clients.forEach((client) => {
      if (
        client != this.#editorSocket &&
        client.readyState === WebSocket.OPEN
      ) {
        console.log(
          chalk.dim("[editor]"),
          `Sending ${chalk.green(event.type)} event.`
        );
        client.send(JSON.stringify(event));
      }
    });
  }

  createEditor() {
    const editor = spawn(
      path.join(dirname, "../node_modules/.bin/ts-node-esm"),
      [path.join(this.#srcPath, "index.ts")],
      {
        env: {
          ...process.env,
          PIXELHEART_SERVER_PORT: this.#port.toString(),
        },
        cwd: this.#srcPath,
        stdio: ["inherit", "inherit", "inherit", "ipc"],
      }
    );

    editor.on("exit", (code: number) => {
      console.log(chalk.dim("[editor]"), `Closed(${code}).`);
      this.createEditor();
    });
  }
}
