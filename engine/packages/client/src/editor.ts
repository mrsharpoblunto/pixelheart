import { GameContext } from "./game.js";
import { SpriteSheetConfig } from "./sprite.js";

export interface EditorMutation {
  type: string;
}

export type BaseActions =
  | {
    type: "RESTART";
  }
  | {
    type: "INIT";
    outputRoot: string;
  };

export type BaseEvents =
  | { type: "EDITOR_CONNECTED" }
  | { type: "EDITOR_DISCONNECTED" }
  | { type: "RELOAD_STATIC"; resources: { [key: string]: string } }
  | { type: "RELOAD_MAP"; map: string }
  | { type: "RELOAD_GAME_PLUGIN"; src: string }
  | { type: "RELOAD_SHADER"; shader: string; src: string }
  | { type: "RELOAD_SPRITESHEET"; spriteSheet: SpriteSheetConfig };

export interface EditorConnection<Actions, Events> {
  send: (data: Actions) => void;
  listen(cb: (data: Events) => void): void;
  disconnect(cb: (data: Events) => void): void;
}

export interface EditorContext<
  Actions extends EditorMutation,
  Events extends EditorMutation
> extends GameContext {
  // the client recieves events and sends actions
  editorServer: EditorConnection<Actions, Events>;
}

type EditorRenderTargetScope = (renderTarget: ImageBitmapRenderingContext, callback: () => void) => void;

export interface EditorClient<
  State,
  EditorState,
  PersistentEditorState,
  Actions extends EditorMutation,
  Events extends EditorMutation
> {
  onStart(
    ctx: EditorContext<Actions, Events>,
    state: State,
    container: HTMLElement,
    previousState?: PersistentEditorState
  ): EditorState;
  onEnd(ctx: EditorContext<Actions, Events>, container: HTMLElement): void;
  onSave(editor: EditorState): PersistentEditorState | null;
  onUpdate(
    ctx: EditorContext<Actions, Events>,
    state: State,
    editor: EditorState,
    fixedDelta: number
  ): void;
  onDraw(
    ctx: EditorContext<Actions, Events>,
    state: State,
    editor: EditorState,
    delta: number
  ): void;
  onDrawExtra(
    ctx: EditorContext<Actions, Events>,
    state: State,
    editor: EditorState,
    delta: number,
    renderScope: EditorRenderTargetScope
  ): void;
}

export class ClientEditorConnection<
  Actions extends EditorMutation,
  Events extends EditorMutation
> implements EditorConnection<Actions, Events>
{
  #eventHandlers: Array<(event: Events) => void>;
  #requestBuffer: Array<Actions>;
  #socket: WebSocket | null;

  constructor() {
    this.#eventHandlers = [];
    this.#requestBuffer = [];
    this.#socket = null;
    this.#createSocket();
  }

  #createSocket() {
    (this.#socket =
      process.env.NODE_ENV === "development"
        ? new WebSocket(
          `ws://${window.location.hostname}:${parseInt(window.location.port, 10) + 1
          }`
        )
        : null),
      this.#socket?.addEventListener("message", (e) => {
        for (const handler of this.#eventHandlers) {
          handler(JSON.parse(e.data) as Events);
        }
      });
    this.#socket?.addEventListener("open", () => {
      console.log(`Connected to editor server, sending ${this.#requestBuffer.length} queued requests...`);
      for (const request of this.#requestBuffer) {
        this.send(request);
      }
      this.#requestBuffer = [];
    });

    this.#socket?.addEventListener("close", () => {
      console.error("Editor server disconnected");
      for (const handler of this.#eventHandlers) {
        handler({
          type: "EDITOR_DISCONNECTED",
        } as Events);
      }
      setTimeout(() => {
        console.warn("Attempting to reconnect to editor server...");
        this.#socket = null;
        this.#createSocket();
      }, 1000);
    });
  }

  send(action: Actions) {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket?.send(JSON.stringify(action));
    } else {
      console.warn(`Editor server not connected, queueing request ${action.type}`);
      this.#requestBuffer.push(action);
    }
  }

  listen(cb: (event: Events) => void) {
    this.#eventHandlers.push(cb);
  }

  disconnect(cb: (event: Events) => void) {
    for (let i = this.#eventHandlers.length - 1; i >= 0; --i) {
      if (cb === this.#eventHandlers[i]) {
        this.#eventHandlers.splice(i, 1);
      }
    }
  }
}
