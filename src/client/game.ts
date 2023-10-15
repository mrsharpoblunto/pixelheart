import { GameContext } from "./game-runner";
import { vec4, vec3 } from "gl-matrix";
import { CPUReadableTexture, loadCPUReadableTextureFromUrl } from "./images";
import { loadSpriteSheet } from "./sprite-common";
import {
  deferredTextureLoader,
  DeferredSpriteSheet,
  DeferredSpriteAnimator,
  DeferredSpriteEffect,
} from "./deferred-sprite-effect";
import { SimpleSpriteEffect } from "./sprite-effect";
import { WaterEffect } from "./water-effect";
import { GaussianBlurEffect } from "./gaussian-blur";
import { SolidEffect } from "./solid-effect";
import overworldSprite from "./sprites/overworld";
import characterSprite from "./sprites/character";
import * as coords from "./coordinates";
import { vec2, ReadonlyVec4 } from "gl-matrix";
import { EditorAction } from "../shared/editor-actions";

const CONTROLLER_DEADZONE = 0.25;
const CURRENT_SERIALIZATION_VERSION = 1;

export interface SerializedGameState {
  version: number;
  character: {
    position: [number, number];
    direction: string;
  };
}

export interface GameState {
  spriteEffect: DeferredSpriteEffect;
  simpleSpriteEffect: SimpleSpriteEffect;
  solidEffect: SolidEffect;
  map: CPUReadableTexture;
  mapBuffer: ImageData;
  overworld: DeferredSpriteSheet;
  character: {
    sprite: DeferredSpriteSheet;
    animator: DeferredSpriteAnimator;
    position: vec2;
    relativePosition: vec2;
    speed: number;
  };
  screen: {
    absolutePosition: vec2;
    width: number;
    height: number;
    toScreenSpace: (out: vec4, relativeRect: ReadonlyVec4) => vec4;
  };
  animationTimer: number;
  waterEffect: WaterEffect;
  blurEffect: GaussianBlurEffect;
  editor?: EditorState;
}

export interface EditorState {
  active: boolean;
  newValue: number | null;
  queued: Array<EditorAction>;
  pending: Array<EditorAction>;
  isUpdating: boolean;
}

export function onSave(state: GameState): SerializedGameState {
  return {
    version: 1,
    character: {
      position: [state.character.position[0], state.character.position[1]],
      direction: state.character.animator.getSpriteName(),
    },
  };
}

export async function onStart(
  ctx: GameContext,
  previousState?: SerializedGameState
): Promise<GameState> {
  if (
    previousState &&
    previousState.version !== CURRENT_SERIALIZATION_VERSION
  ) {
    // if its possible to gracefully handle loading a previous version, do so
    // otherwise, throw an error
    throw new Error(`Invalid save version ${previousState.version}`);
  }

  const overworld = await loadSpriteSheet(
    ctx,
    overworldSprite,
    deferredTextureLoader
  );
  const character = await loadSpriteSheet(
    ctx,
    characterSprite,
    deferredTextureLoader
  );
  const state: GameState = {
    spriteEffect: new DeferredSpriteEffect(ctx.gl),
    simpleSpriteEffect: new SimpleSpriteEffect(ctx.gl),
    solidEffect: new SolidEffect(ctx.gl),
    map: await loadCPUReadableTextureFromUrl(ctx, "./images/walkmap.png"),
    mapBuffer: new ImageData(
      ctx.screen.width / coords.TILE_SIZE + 2,
      ctx.screen.height / coords.TILE_SIZE + 2
    ),
    overworld: overworld,
    character: {
      sprite: character,
      animator: new DeferredSpriteAnimator(
        character,
        previousState ? previousState.character.direction : "walk_d",
        8 / 1000
      ),
      position: previousState
        ? vec2.fromValues(
            previousState.character.position[0],
            previousState.character.position[1]
          )
        : vec2.fromValues(ctx.screen.width / 2, ctx.screen.height / 2),
      relativePosition: vec2.create(),
      speed: 1,
    },
    waterEffect: new WaterEffect(ctx.gl),
    blurEffect: new GaussianBlurEffect(ctx.gl),
    animationTimer: 0,
    screen: {
      ...ctx.screen,
      absolutePosition: vec2.create(),
    },
  };

  if (process.env.NODE_ENV === "development") {
    state.editor = {
      active: false,
      newValue: null,
      queued: [],
      pending: [],
      isUpdating: false,
    };
    setInterval(() => {
      if (!state.editor) {
        return;
      }
      pushEdits(state.editor);
    }, 1000);
  }

  // Draw the walkmap offscreen
  ctx.offscreen.drawImage(
    state.map.image,
    0,
    0,
    state.map.width,
    state.map.height
  );

  return state;
}

function pushEdits(editor: EditorState) {
  if (editor.queued.length && !editor.isUpdating) {
    fetch("/edit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(editor.queued),
    })
      .then((r) => {
        if (!r.ok) {
          throw new Error("Network response was not ok");
        }
        return r.json();
      })
      .then((_data) => {
        editor.pending = [];
        editor.isUpdating = false;
      })
      .catch((_err) => {
        // re-queue events that failed
        editor.queued = editor.pending.concat(editor.queued);
        editor.pending = [];
        editor.isUpdating = false;
      });
    editor.pending = editor.queued;
    editor.queued = [];
  }
}

export function onUpdate(
  ctx: GameContext,
  state: GameState,
  fixedDelta: number
) {
  const direction: { [key: string]: boolean } = {};

  // gamepad input
  const gp = ctx.getGamepad();
  if (gp) {
    if (
      gp.buttons[12].pressed ||
      Math.min(0.0, gp.axes[1] + CONTROLLER_DEADZONE) < 0
    ) {
      direction.up = true;
    }
    if (
      gp.buttons[13].pressed ||
      Math.max(0.0, gp.axes[1] - CONTROLLER_DEADZONE) > 0
    ) {
      direction.down = true;
    }
    if (
      gp.buttons[14].pressed ||
      Math.min(0.0, gp.axes[0] + CONTROLLER_DEADZONE) < 0
    ) {
      direction.left = true;
    }
    if (
      gp.buttons[15].pressed ||
      Math.max(0.0, gp.axes[0] - CONTROLLER_DEADZONE) > 0
    ) {
      direction.right = true;
    }
  }

  // keyboard input
  if (ctx.keys.pressed.has("f") && ctx.keys.down.has("Control")) {
    if (!document.fullscreenElement) {
      ctx.canvas.requestFullscreen();
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
  if (ctx.keys.down.has("w") || ctx.keys.down.has("ArrowUp")) {
    direction.up = true;
  }
  if (ctx.keys.down.has("s") || ctx.keys.down.has("ArrowDown")) {
    direction.down = true;
  }
  if (ctx.keys.down.has("a") || ctx.keys.down.has("ArrowLeft")) {
    direction.left = true;
  }
  if (ctx.keys.down.has("d") || ctx.keys.down.has("ArrowRight")) {
    direction.right = true;
  }

  let newDirection: keyof typeof characterSprite.sprites | null = null;
  // direction animations are mutually exclusive
  if (direction.left) {
    newDirection = "walk_l";
  } else if (direction.right) {
    newDirection = "walk_r";
  } else if (direction.up) {
    newDirection = "walk_u";
  } else if (direction.down) {
    newDirection = "walk_d";
  }

  if (newDirection) {
    state.character.animator.setSpriteOrTick(newDirection, fixedDelta);
  }

  // provide a stable looping animation
  state.animationTimer += fixedDelta / 4000;
  if (state.animationTimer > Math.PI * 2) {
    state.animationTimer -= Math.PI * 2;
  }

  // but movement is not
  const movement = vec2.create();
  if (direction.left) {
    movement[0]--;
  }
  if (direction.right) {
    movement[0]++;
  }
  if (direction.up) {
    movement[1]--;
  }
  if (direction.down) {
    movement[1]++;
  }
  // make sure angular movement isn't faster than up/down/left/right
  vec2.normalize(movement, movement);
  vec2.scale(movement, movement, state.character.speed);
  vec2.add(movement, movement, state.character.position);

  const isWater = false; // ctx.offscreen.getImageData(newPositionX / TILE_SIZE, newPositionY / TILE_SIZE, 1, 1).data[0]===0;

  if (!isWater) {
    const renderOffset = vec2.fromValues(
      state.character.animator.getSprite().width / 2,
      state.character.animator.getSprite().height / 2
    );
    const mapSize = vec2.fromValues(
      state.map.width * coords.TILE_SIZE,
      state.map.height * coords.TILE_SIZE
    );
    vec2.subtract(mapSize, mapSize, renderOffset);
    vec2.min(state.character.position, movement, mapSize);
    vec2.max(state.character.position, state.character.position, renderOffset);
  }

  // character position relative to the top left of the screen
  state.character.relativePosition[0] =
    state.character.position[0] < ctx.screen.width / 2
      ? state.character.position[0]
      : state.character.position[0] >
        state.map.width * coords.TILE_SIZE - ctx.screen.width / 2
      ? state.character.position[0] -
        state.map.width * coords.TILE_SIZE +
        ctx.screen.width
      : ctx.screen.width / 2;
  state.character.relativePosition[1] =
    state.character.position[1] < ctx.screen.height / 2
      ? state.character.position[1]
      : state.character.position[1] >
        state.map.height * coords.TILE_SIZE - ctx.screen.height / 2
      ? state.character.position[1] -
        state.map.height * coords.TILE_SIZE +
        ctx.screen.height
      : ctx.screen.height / 2;

  // Record the scroll offset of the screen
  vec2.subtract(
    state.screen.absolutePosition,
    state.character.position,
    state.character.relativePosition
  );

  const ssp = coords.toAbsoluteTileFromAbsolute(
    vec4.create(),
    state.screen.absolutePosition
  );

  // read in all the onscreen tiles
  state.mapBuffer = ctx.offscreen.getImageData(
    ssp[0] - 1,
    ssp[1] - 1,
    ctx.screen.width / coords.TILE_SIZE + 3,
    ctx.screen.height / coords.TILE_SIZE + 3
  );

  if (process.env.NODE_ENV === "development") {
    updateEditor(ctx, state, fixedDelta);
  }
}

export function onDraw(ctx: GameContext, state: GameState, delta: number) {
  ctx.gl.enable(ctx.gl.BLEND);
  ctx.gl.blendFunc(ctx.gl.SRC_ALPHA, ctx.gl.ONE_MINUS_SRC_ALPHA);

  const ssp = coords.toAbsoluteTileFromAbsolute(
    vec4.create(),
    state.screen.absolutePosition
  );

  let sin = Math.sin(state.animationTimer);
  sin = Math.min(1.0, sin + 0.5);

  const day = Math.pow(Math.max(0, sin), 8);

  state.spriteEffect
    .addDirectionalLight({
      ambient: vec3.fromValues(
        0.2 + day * 0.3,
        0.2 + day * 0.3,
        0.4 + day * 0.1
      ),
      direction: vec3.fromValues(
        Math.cos(state.animationTimer),
        day * 0.5,
        -1.0
      ),
      diffuse: vec3.fromValues(
        Math.pow(day, 0.25) * (1 - day) + day * 0.5,
        day * 0.5,
        day * 0.45
      ),
    })
    .addPointLight({
      diffuse: vec3.fromValues(
        0.6 * (1 - day),
        0.6 * (1 - day),
        0.3 * (1 - day)
      ),
      position: vec3.fromValues(
        ctx.mouse.position[0] / ctx.screen.width,
        ctx.mouse.position[1] / ctx.screen.height,
        0.1
      ),
      radius: 0.5,
    })
    .use(
      {
        width: ctx.screen.width,
        height: ctx.screen.height,
      },
      (s, pass) => {
        if (pass === 0) {
          // overdraw the screen by 1 tile at each edge to prevent tile pop-in
          for (
            let x = -1;
            x <= (ctx.screen.width + 2) / coords.TILE_SIZE;
            ++x
          ) {
            for (
              let y = -1;
              y <= (ctx.screen.height + 2) / coords.TILE_SIZE;
              ++y
            ) {
              const mapX = x + ssp[0];
              const mapY = y + ssp[1];
              const spatialHash = hash(mapX, mapY);

              const position = ctx.screen.toScreenSpace(
                vec4.create(),
                vec4.fromValues(
                  y * coords.TILE_SIZE - ssp[3],
                  x * coords.TILE_SIZE + coords.TILE_SIZE - ssp[2],
                  y * coords.TILE_SIZE + coords.TILE_SIZE - ssp[3],
                  x * coords.TILE_SIZE - ssp[2]
                )
              );

              if (getMapBufferData(x, y, state) !== 0) {
                // not water
                const top = getMapBufferData(x, y - 1, state) === 0;
                const left = getMapBufferData(x - 1, y, state) === 0;
                const bottom = getMapBufferData(x, y + 1, state) === 0;
                const right = getMapBufferData(x + 1, y, state) === 0;
                const topLeft = getMapBufferData(x - 1, y - 1, state) === 0;
                const topRight = getMapBufferData(x + 1, y - 1, state) === 0;
                const bottomLeft = getMapBufferData(x - 1, y + 1, state) === 0;
                const bottomRight = getMapBufferData(x + 1, y + 1, state) === 0;

                if (top && left) {
                  state.overworld.grass_tl.draw(s, position);
                } else if (top && right) {
                  state.overworld.grass_tr.draw(s, position);
                } else if (top && !left && !right) {
                  state.overworld.grass_t.draw(s, position);
                } else if (topLeft && !left && !top) {
                  state.overworld.grass_i_tl.draw(s, position);
                } else if (topRight && !right && !top) {
                  state.overworld.grass_i_tr.draw(s, position);
                } else if (left && !top && !bottom) {
                  state.overworld.grass_l.draw(s, position);
                } else if (bottom && left) {
                  state.overworld.grass_bl.draw(s, position);
                } else if (bottom && right) {
                  state.overworld.grass_br.draw(s, position);
                } else if (bottom && !left && !right) {
                  state.overworld.grass_b.draw(s, position);
                } else if (bottomLeft && !left && !bottom) {
                  state.overworld.grass_i_bl.draw(s, position);
                } else if (bottomRight && !right && !bottom) {
                  state.overworld.grass_i_br.draw(s, position);
                } else if (right && !top && !bottom) {
                  state.overworld.grass_r.draw(s, position);
                } else {
                  state.overworld.grass.draw(s, position, spatialHash);
                }
              }
            }
          }
        } else {
          const offset = vec2.fromValues(
            state.character.animator.getSprite().width / 2,
            state.character.animator.getSprite().height / 2
          );

          state.character.animator.draw(
            s,
            ctx.screen.toScreenSpace(
              vec4.create(),
              vec4.fromValues(
                Math.floor(state.character.relativePosition[1]) - offset[1],
                Math.floor(state.character.relativePosition[0]) + offset[0],
                Math.floor(state.character.relativePosition[1]) + offset[1],
                Math.floor(state.character.relativePosition[0]) - offset[0]
              )
            )
          );
        }
      },
      (mask) => {
        state.blurEffect.draw(mask, 0.5);
        state.waterEffect.draw(mask, state.blurEffect.getBlurTexture());
      }
    );

  // draw the accumulated deferred lighting texture to the screen
  state.simpleSpriteEffect.use((s) => {
    const lightingTexture = state.spriteEffect.getLightingTexture();
    if (lightingTexture) {
      s.setTextures(lightingTexture);
      s.draw(
        vec4.fromValues(1.0, 1.0, 0, 0),
        vec4.fromValues(0, lightingTexture.width, lightingTexture.height, 0)
      );
    }
  });

  if (process.env.NODE_ENV === "development") {
    drawEditor(ctx, state, delta);
  }
}

function updateEditor(ctx: GameContext, state: GameState, _fixedDelta: number) {
  if (!state.editor) return;

  if (ctx.keys.pressed.has("m") && ctx.keys.down.has("Control")) {
    state.editor.active = !state.editor.active;
  }

  if (!state.editor.active) {
    return;
  }

  if (ctx.mouse.down[0]) {
    const rp = coords.toRelativeTileFromRelative(
      vec4.create(),
      ctx.mouse.position,
      state.screen
    );

    const ap = coords.pickAbsoluteTileFromRelative(
      vec4.create(),
      ctx.mouse.position,
      state.screen
    );

    if (state.editor.newValue === null) {
      state.editor.newValue =
        getMapBufferData(rp[0], rp[1], state) === 0 ? 255 : 0;
    }
    setMapBufferData(rp[0], rp[1], state.editor.newValue, state);
    const ssp = coords.toAbsoluteTileFromAbsolute(
      vec4.create(),
      state.screen.absolutePosition
    );
    ctx.offscreen.putImageData(state.mapBuffer, ssp[0] - 1, ssp[1] - 1);

    const found = rfind(
      state.editor.queued,
      (e) => e.type === "TILE_CHANGE" && e.x === ap[0] && e.y === ap[1]
    );

    if (found && found.type === "TILE_CHANGE") {
      found.value = state.editor.newValue;
    } else {
      state.editor.queued.push({
        type: "TILE_CHANGE",
        x: ap[0],
        y: ap[1],
        value: state.editor.newValue,
      });
    }
  } else {
    state.editor.newValue = null;
  }
}

function rfind<T>(
  arr: Array<T>,
  predicate: (value: T, index: number, arr: Array<T>) => boolean
): T | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i], i, arr)) {
      return arr[i];
    }
  }
  return null;
}

function drawEditor(ctx: GameContext, state: GameState, _delta: number) {
  if (!state.editor) return;

  if (state.editor.active) {
    const ap = coords.pickAbsoluteTileFromRelative(
      vec4.create(),
      ctx.mouse.position,
      state.screen
    );

    state.solidEffect.use((s) => {
      s.draw(
        coords.toScreenSpaceFromAbsoluteTile(vec4.create(), ap, state.screen),
        vec4.fromValues(1.0, 0, 0, 0.5)
      );
    });
  }
}

function getMapBufferData(x: number, y: number, state: GameState): number {
  const width = state.screen.width / coords.TILE_SIZE + 3;
  return state.mapBuffer.data[4 * (width * (y + 1) + x + 1)];
}

function setMapBufferData(
  x: number,
  y: number,
  value: number,
  state: GameState
) {
  const width = state.screen.width / coords.TILE_SIZE + 3;
  state.mapBuffer.data[4 * (width * (y + 1) + x + 1)] = value;
}

function hash(x: number, y: number): number {
  const A = 48271;
  const M = 2147483647;
  const Q = M / A;
  const R = M % A;

  let temp = A * (x % Q) - R * Math.floor(x / Q);
  if (temp >= 0) x = temp;
  else x = temp + M;

  temp = A * (y % Q) - R * Math.floor(y / Q);
  if (temp >= 0) y = temp;
  else y = temp + M;

  return x ^ y;
}
