import { MessagePort } from "worker_threads";

import { EditorConnection, EditorMutation } from "./api";

export class ClientEditorConnection<
  Actions extends EditorMutation,
  Events extends EditorMutation
> implements EditorConnection<Actions, Events>
{
  #eventHandlers: Array<(event: Events) => void>;
  #socket: WebSocket | null;

  constructor() {
    this.#eventHandlers = [];
    this.#socket = process.env.NODE_ENV === "development"
          ? new WebSocket(
              `ws://${window.location.hostname}:${
                parseInt(window.location.port, 10) + 1
              }`
            )
          : null,
    this.#socket?.addEventListener("message", (e) => {
      for (const handler of this.#eventHandlers) {
        handler(JSON.parse(e.data) as Events);
      }
    });
    this.#socket?.addEventListener("close", () => {
      for (const handler of this.#eventHandlers) {
        handler({
          type: "EDITOR_DISCONNECTED",
        } as Events);
      }
    });
  }
  send(action: Actions) {
    this.#socket?.send(JSON.stringify(action));
  }
  onEvent(cb: (event: Events) => void) {
    this.#eventHandlers.push(cb);
  }
}

export class ServerWorkerEditorConnection<
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
