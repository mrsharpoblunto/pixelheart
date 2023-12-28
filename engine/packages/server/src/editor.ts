import watcher from "@parcel/watcher";
import chalk from "chalk";
import { existsSync } from "fs";
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
  #gameOutputPath: string | null;
  #port: number;
  #changed: boolean;

  constructor(port: number) {
    super();
    this.#port = port;
    this.#editorSocket = null;
    this.#requestBuffer = new Array<EditorMutation>();
    this.#gameOutputPath = null;
    this.#changed = true;

    this.#wss = new WebSocketServer({ port });
    this.#wss.on("listening", () => {
      this.#log(`Listening on port ${port} `);
    });
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
                outputRoot: this.#gameOutputPath,
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

    this.on("event", (event: EditorMutation) => {
      this.#broadcast(event);
    });
  }

  start(gameEditorServerPath: string, gameOutputPath: string) {
    this.#gameOutputPath = gameOutputPath

    if (!existsSync(gameEditorServerPath)) {
      this.#log(chalk.yellow(`Server path ${gameEditorServerPath} not found`));
      return;
    }

    // restart when the editor src changes
    watcher.subscribe(
      gameEditorServerPath,
      async (_err, _events) => {
        this.#changed = true;
        if (this.#sendToEditor([{ type: "RESTART" }])) {
          this.#log("Reloading...");
          this.#editorSocket = null;
        }
      },
      {
        ignore: ["client/**"],
      }
    );

    this.#createEditor(gameEditorServerPath);
  }

  #log(message: string) {
    console.log(chalk.dim("[editor]"), message);
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
        this.#log(
          `Sending ${chalk.green(event.type)} event.`
        );
        client.send(JSON.stringify(event));
      }
    });
  }

  #createEditor(p: string) {
    if (!this.#changed) {
      setTimeout(() => this.#createEditor(p), 1000);
      return;
    }
    this.#changed = false;

    const serverEntrypoint = path.join(p, "index.ts");

    if (!existsSync(serverEntrypoint)) {
      this.#log(chalk.yellow(`Server entrypoint ${serverEntrypoint} not found`));
      return;
    }

    const editor = spawn(
      path.join(dirname, "../node_modules/.bin/ts-node-esm"),
      [serverEntrypoint],
      {
        env: {
          ...process.env,
          PIXELHEART_SERVER_PORT: this.#port.toString(),
        },
        cwd: p,
      }
    );

    editor.stdout.on("data", (data) => {
      process.stdout.write(chalk.dim("[editor] "));
      process.stdout.write(data.toString());
    });

    editor.stderr.on("data", (data) => {
      process.stdout.write(chalk.dim("[editor] "));
      process.stdout.write(chalk.red(data.toString()));
    });

    editor.on("error", (err) => {
      this.#log(chalk.red(err.toString()));
    });

    editor.on("exit", (code: number) => {
      this.#log(`Closed (${code}).`);
      this.#createEditor(p);
    });
  }
}
