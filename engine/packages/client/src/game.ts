import { vec2, vec4, ReadonlyVec4 } from "gl-matrix";

export interface GameContext {
  gl: WebGL2RenderingContext;
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

export interface GameClient<State, PersistentState> {
  onStart(ctx: GameContext, previousState?: PersistentState): State;
  onSave(state: State): PersistentState | null;
  onUpdate(ctx: GameContext, state: State, fixedDelta: number): void;
  onDraw(ctx: GameContext, state: State, delta: number): void;
}
