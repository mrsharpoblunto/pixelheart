import { RenderContext } from "./game-runner";
import { CPUReadableTexture, loadCPUReadableTextureFromUrl } from "./images";
import {
  SpriteSheet,
  loadSpriteSheet,
  SpriteAnimator,
  SpriteEffect,
} from "./sprite-effect";
import overworldSprite from "./sprites/overworld";
import characterSprite from "./sprites/character";

const CONTROLLER_DEADZONE = 0.25;
const TILE_SIZE = 16;

export interface SerializedGameState {
  character: {
    position: { x: number; y: number };
    direction: keyof typeof characterSprite.sprites;
  };
}

export interface GameState {
  spriteEffect: SpriteEffect;
  map: CPUReadableTexture;
  overworld: SpriteSheet;
  character: {
    sprite: SpriteSheet;
    animator: SpriteAnimator;
    direction: keyof typeof characterSprite.sprites;
    position: { x: number; y: number };
    speed: number;
  };
  selectedGamepadIndex: number | null;
  keys: { [key: string]: boolean };
  world: { width: number; height: number };
  water: SpriteAnimator;
}

export function onSave(state: GameState): SerializedGameState {
  return {
    character: {
      position: state.character.position,
      direction: state.character.direction,
    },
  };
}

export async function onStart(
  ctx: RenderContext,
  world: { width: number; height: number },
  previousState?: SerializedGameState
): Promise<GameState> {
  const overworld = await loadSpriteSheet(ctx, overworldSprite);
  const character = await loadSpriteSheet(ctx, characterSprite);
  const state: GameState = {
    spriteEffect: new SpriteEffect(ctx.gl),
    map: await loadCPUReadableTextureFromUrl(ctx, "/images/walkmap.png"),
    overworld: overworld,
    character: {
      sprite: character,
      animator: new SpriteAnimator(
        character[previousState ? previousState.character.direction : "walk_d"],
        8 / 1000
      ),
      direction: previousState ? previousState.character.direction : "walk_d",
      position: previousState
        ? previousState.character.position
        : { x: world.width / 2 + 50, y: world.height / 2 },
      speed: 1,
    },
    water: new SpriteAnimator(overworld.water, 6 / 1000),
    world,
    selectedGamepadIndex: null,
    keys: {},
  };

  // Draw the walkmap offscreen
  ctx.offscreen.drawImage(
    state.map.image,
    0,
    0,
    state.map.width,
    state.map.height
  );

  window.addEventListener("gamepadconnected", (e) => {
    state.selectedGamepadIndex = e.gamepad.index;
  });
  window.addEventListener("gamepaddisconnected", (_) => {
    state.selectedGamepadIndex = null;
  });
  window.addEventListener("keydown", (e) => {
    state.keys[e.key] = true;
  });
  window.addEventListener("keyup", (e) => {
    delete state.keys[e.key];
  });

  return state;
}

export function onDraw(ctx: RenderContext, state: GameState, _delta: number) {
  ctx.gl.enable(ctx.gl.BLEND);
  ctx.gl.blendFunc(ctx.gl.SRC_ALPHA, ctx.gl.ONE_MINUS_SRC_ALPHA);

  state.spriteEffect.use((s) => {
    const characterTileOffset = {
      x: Math.floor(state.character.position.x) % TILE_SIZE,
      y: Math.floor(state.character.position.y) % TILE_SIZE,
    };
    const centerOffset = {
      x:
        Math.floor(state.character.position.x / TILE_SIZE) -
        state.world.width / (TILE_SIZE * 2),
      y:
        Math.floor(state.character.position.y / TILE_SIZE) -
        state.world.height / (TILE_SIZE * 2),
    };

    for (let x = -1; x < (state.world.width + 1) / TILE_SIZE; ++x) {
      for (let y = -1; y < (state.world.height + 1) / TILE_SIZE; ++y) {
        const mapX = x + centerOffset.x;
        const mapY = y + centerOffset.y;
        const spatialHash = hash(mapX, mapY);

        const position = {
          top: (y * TILE_SIZE - characterTileOffset.y) / state.world.height,
          left: (x * TILE_SIZE - characterTileOffset.x) / state.world.width,
          bottom:
            (y * TILE_SIZE + TILE_SIZE - characterTileOffset.y) /
            state.world.height,
          right:
            (x * TILE_SIZE + TILE_SIZE - characterTileOffset.x) /
            state.world.width,
        };

        if (ctx.offscreen.getImageData(mapX, mapY, 1, 1).data[0] === 0) {
          // water
          state.water.draw(s, position, spatialHash);
        } else {
          // not water
          const top =
            ctx.offscreen.getImageData(mapX, mapY - 1, 1, 1).data[0] === 0;
          const left =
            ctx.offscreen.getImageData(mapX - 1, mapY, 1, 1).data[0] === 0;
          const bottom =
            ctx.offscreen.getImageData(mapX, mapY + 1, 1, 1).data[0] === 0;
          const right =
            ctx.offscreen.getImageData(mapX + 1, mapY, 1, 1).data[0] === 0;
          const topLeft =
            ctx.offscreen.getImageData(mapX - 1, mapY - 1, 1, 1).data[0] === 0;
          const topRight =
            ctx.offscreen.getImageData(mapX + 1, mapY - 1, 1, 1).data[0] === 0;
          const bottomLeft =
            ctx.offscreen.getImageData(mapX - 1, mapY + 1, 1, 1).data[0] === 0;
          const bottomRight =
            ctx.offscreen.getImageData(mapX + 1, mapY + 1, 1, 1).data[0] === 0;

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

    const offset = {
      x: state.character.animator.getSprite().width / 2,
      y: state.character.animator.getSprite().height / 2,
    };
    state.character.animator.draw(s, {
      top: Math.floor(state.world.height / 2 - offset.y) / state.world.height,
      left: Math.floor(state.world.width / 2 - offset.x) / state.world.width,
      bottom:
        Math.floor(state.world.height / 2 + offset.y) / state.world.height,
      right: Math.floor(state.world.width / 2 + offset.x) / state.world.width,
    });
  });
}

export function onUpdate(
  ctx: RenderContext,
  state: GameState,
  fixedDelta: number
) {
  const direction: { [key: string]: boolean } = {};
  // gamepad input
  if (state.selectedGamepadIndex !== null) {
    const gp = navigator.getGamepads()[state.selectedGamepadIndex];
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
  }
  // keyboard input
  if (state.keys["w"] || state.keys["ArrowUp"]) {
    direction.up = true;
  }
  if (state.keys["s"] || state.keys["ArrowDown"]) {
    direction.down = true;
  }
  if (state.keys["a"] || state.keys["ArrowLeft"]) {
    direction.left = true;
  }
  if (state.keys["d"] || state.keys["ArrowRight"]) {
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
    state.character.animator.setSpriteOrTick(
      state.character.sprite[newDirection],
      fixedDelta
    );
    state.character.direction = newDirection;
  }

  state.water.tick(fixedDelta);

  // but movement is not
  const movement = { x: 0, y: 0 };
  if (direction.left) {
    movement.x -= state.character.speed;
  }
  if (direction.right) {
    movement.x += state.character.speed;
  }
  if (direction.up) {
    movement.y -= state.character.speed;
  }
  if (direction.down) {
    movement.y += state.character.speed;
  }
  // make sure angular movement isn't faster than up/down/left/right
  normalizeVector(movement);

  const newPositionX = state.character.position.x + movement.x;
  const newPositionY = state.character.position.y + movement.y;
  const isWater = false; // ctx.offscreen.getImageData(newPositionX / TILE_SIZE, newPositionY / TILE_SIZE, 1, 1).data[0]===0;

  if (
    newPositionX < state.map.width * TILE_SIZE &&
    newPositionX >= 0 &&
    !isWater
  ) {
    state.character.position.x = newPositionX;
  }
  if (
    newPositionY < state.map.height * TILE_SIZE &&
    newPositionY >= 0 &&
    !isWater
  ) {
    state.character.position.y = newPositionY;
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

function normalizeVector(v: { x: number; y: number }) {
  const length = Math.sqrt(v.x * v.x + v.y * v.y);
  if (length === 0) {
    v.x = 0;
    v.y = 0;
  } else {
    v.x /= length;
    v.y /= length;
  }
}
