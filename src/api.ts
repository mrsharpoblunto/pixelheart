import { vec2, vec4, ReadonlyVec4 } from "gl-matrix";
import { SpriteSheetConfig } from "./sprite";

export interface EditorAction {
  type: string;
}

export type BaseActions = {
  type: "RESTART";
};

export interface EditorEvent {
  type: string;
}

export type BaseEvents =
  | { type: "EDITOR_DISCONNECTED" }
  | { type: "RELOAD_MAP"; map: string }
  | { type: "RELOAD_SHADER"; shader: string; src: string }
  | { type: "RELOAD_SPRITESHEET"; spriteSheet: SpriteSheetConfig };

export interface EditorConnection<Events> {
  send: (data: Events) => void;
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

export interface EditorContext<Actions extends EditorAction>
  extends GameContext {
  editor: EditorConnection<Actions>;
}

export interface EditorClient<
  State,
  EditorState,
  PersistentEditorState,
  Actions extends EditorAction,
  Events extends EditorEvent
> {
  onStart(
    ctx: EditorContext<Actions>,
    state: State,
    container: HTMLElement,
    persistedEditor?: PersistentEditorState
  ): EditorState;
  onEnd(container: HTMLElement): void;
  onSave(editor: EditorState): PersistentEditorState | null;
  onEvent(
    ctx: EditorContext<Actions>,
    state: State,
    editor: EditorState,
    event: Events
  ): void;
  onUpdate(
    ctx: EditorContext<Actions>,
    state: State,
    editor: EditorState,
    fixedDelta: number
  ): void;
  onDraw(
    ctx: EditorContext<Actions>,
    state: State,
    editor: EditorState,
    delta: number
  ): void;
}

export interface EditorServer<
  Actions extends EditorAction,
  Events extends EditorEvent
> {
  onConnect(editorConnection: EditorConnection<Events>): Promise<void>;
  onAction(action: Actions): Promise<void>;
}

export interface GameClient<State, PersistentState> {
  onStart(ctx: GameContext, persistedState?: PersistentState): State;
  onSave(state: State): PersistentState | null;
  onUpdate(ctx: GameContext, state: State, fixedDelta: number): void;
  onDraw(ctx: GameContext, state: State, delta: number): void;
}
