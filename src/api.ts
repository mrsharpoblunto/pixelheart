import { ReadonlyVec4, vec2, vec4 } from "gl-matrix";

import { SpriteSheetConfig } from "./sprite";

export interface EditorMutation {
  type: string;
}

export type BaseActions = {
  type: "RESTART";
};

export type BaseEvents =
  | { type: "EDITOR_DISCONNECTED" }
  | { type: "RELOAD_STATIC"; resources: { [key: string]: string } }
  | { type: "RELOAD_MAP"; map: string }
  | { type: "RELOAD_SHADER"; shader: string; src: string }
  | { type: "RELOAD_SPRITESHEET"; spriteSheet: SpriteSheetConfig };

export interface EditorConnection<Actions, Events> {
  send: (data: Actions) => void;
  onEvent(cb: (data: Events) => void): void;
}

export interface GameContext {
  gl: WebGL2RenderingContext;
  createOffscreenCanvas: (
    width: number,
    height: number,
    settings?: CanvasRenderingContext2DSettings
  ) => CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  getGamepad: () => Gamepad | null;
  keys: {
    down: Set<string>;
    pressed: Set<string>;
  };
  mouse: {
    position: vec2;
    wheel: vec2;
    down: Array<boolean>;
    clicked: Array<boolean>;
  };
  touches: {
    down: Map<number, { started: number; position: vec2 }>;
    ended: Map<number, { position: vec2 }>;
  };
  screen: {
    width: number;
    height: number;
    safeArea: {
      width: number;
      height: number;
      boundingRect: vec4;
    };
    toScreenSpace: (out: vec4, relativeRect: ReadonlyVec4) => vec4;
  };
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

export interface GameClient<State, PersistentState> {
  onStart(ctx: GameContext, previousState?: PersistentState): State;
  onSave(state: State): PersistentState | null;
  onUpdate(ctx: GameContext, state: State, fixedDelta: number): void;
  onDraw(ctx: GameContext, state: State, delta: number): void;
}
