import { GameContext } from "./game-runner";
import { vec4 } from "gl-matrix";
import { CPUReadableTexture, loadCPUReadableTextureFromUrl } from "./images";
import {
  loadSpriteSheet,
  SpriteAnimator,
  SpriteEffect,
  SpriteSheet,
} from "./sprite-effect";
import { SolidEffect } from "./solid-effect";
import overworldSprite from "./sprites/overworld";
import characterSprite from "./sprites/character";
import * as coords from "./coordinates";
import { vec2, ReadonlyVec4 } from "gl-matrix";

const CONTROLLER_DEADZONE = 0.25;

export interface SerializedGameState {
  character: {
    position: [number, number];
    direction: string;
  };
}

export interface GameState {
  spriteEffect: SpriteEffect;
  solidEffect: SolidEffect;
  map: CPUReadableTexture;
  overworld: SpriteSheet;
  character: {
    sprite: SpriteSheet;
    animator: SpriteAnimator;
    position: vec2;
    relativePosition: vec2;
    speed: number;
  };
  screen: {
    absolutePosition: vec2;
    toScreenSpace: (out: vec4, relativeRect: ReadonlyVec4) => vec4;
  };
  water: SpriteAnimator;
  editor?: EditorState;
}

export interface EditorState {
  active: boolean;
}

export function onSave(state: GameState): SerializedGameState {
  return {
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
  const overworld = await loadSpriteSheet(ctx, overworldSprite);
  const character = await loadSpriteSheet(ctx, characterSprite);
  const state: GameState = {
    spriteEffect: new SpriteEffect(ctx.gl),
    solidEffect: new SolidEffect(ctx.gl),
    map: await loadCPUReadableTextureFromUrl(ctx, "/images/walkmap.png"),
    overworld: overworld,
    character: {
      sprite: character,
      animator: new SpriteAnimator(
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
    water: new SpriteAnimator(overworld, "water", 6 / 1000),
    screen: {
      ...ctx.screen,
      absolutePosition: vec2.create(),
    },
  };
  if (process.env.NODE_ENV === "development") {
    state.editor = {
      active: false,
    };
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

  state.water.tick(fixedDelta);

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

  state.spriteEffect.use((s) => {
    // overdraw the screen by 1 tile at each edge to prevent tile pop-in
    for (let x = -1; x < (ctx.screen.width + 1) / coords.TILE_SIZE; ++x) {
      for (let y = -1; y < (ctx.screen.height + 1) / coords.TILE_SIZE; ++y) {
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

        // get the 9 tiles around the player
        const walkMapData = ctx.offscreen.getImageData(
          mapX - 1,
          mapY - 1,
          3,
          3
        );

        if (walkMapData.data[4 * 4] === 0) {
          // water
          state.water.draw(s, position, spatialHash);
        } else {
          // not water
          const top = walkMapData.data[4 * 1] === 0;
          const left = walkMapData.data[4 * 3] === 0;
          const bottom = walkMapData.data[4 * 7] === 0;
          const right = walkMapData.data[4 * 5] === 0;
          const topLeft = walkMapData.data[4 * 0] === 0;
          const topRight = walkMapData.data[4 * 2] === 0;
          const bottomLeft = walkMapData.data[4 * 6] === 0;
          const bottomRight = walkMapData.data[4 * 8] === 0;

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
}

function drawEditor(ctx: GameContext, state: GameState, _delta: number) {
  if (!state.editor) return;

  if (state.editor.active) {
    state.solidEffect.use((s) => {
      const ap = coords.pickAbsoluteTileFromRelative(
        vec4.create(),
        ctx.mouse.position,
        state.screen
      );
      const rp = coords.toRelativeTileFromAbsoluteTile(
        vec4.create(),
        ap,
        state.screen
      );

      s.draw(
        coords.toScreenSpaceFromAbsoluteTile(vec4.create(), ap, state.screen),
        vec4.fromValues(1.0, 0, 0, 0.5)
      );
    });
  }
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
