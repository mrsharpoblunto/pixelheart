import { SpriteSheetConfig } from "./sprite";
import { GameContext } from "./game";

export interface EditorMutation {
  type: string;
}

export type BaseActions = {
  type: "RESTART";
} | {
  type: "INIT";
  outputRoot: string;
};

export type BaseEvents =
  | { type: "EDITOR_DISCONNECTED" }
  | { type: "RELOAD_STATIC"; resources: { [key: string]: string } }
  | { type: "RELOAD_MAP"; map: string }
  | { type: "RELOAD_GAME_PLUGIN"; src: string }
  | { type: "RELOAD_SHADER"; shader: string; src: string }
  | { type: "RELOAD_SPRITESHEET"; spriteSheet: SpriteSheetConfig };

export interface EditorConnection<Actions, Events> {
  send: (data: Actions) => void;
  onEvent(cb: (data: Events) => void): void;
}

export interface EditorContext<
  Actions extends EditorMutation,
  Events extends EditorMutation
> extends GameContext {
  // the client recieves events and sends actions
  editorServer: EditorConnection<Actions, Events>;
}

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
  onEnd(container: HTMLElement): void;
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
}

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
