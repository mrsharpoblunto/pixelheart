import { GameContext } from "./game-runner";
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
  ctx: GameContext,
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
        : { x: ctx.screen.width / 2 + 50, y: ctx.screen.height / 2 },
      speed: 1,
    },
    water: new SpriteAnimator(overworld.water, 6 / 1000),
  };

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

export function onDraw(ctx: GameContext, state: GameState, _delta: number) {
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
        ctx.screen.width / (TILE_SIZE * 2),
      y:
        Math.floor(state.character.position.y / TILE_SIZE) -
        ctx.screen.height / (TILE_SIZE * 2),
    };

    for (let x = -1; x < (ctx.screen.width + 1) / TILE_SIZE; ++x) {
      for (let y = -1; y < (ctx.screen.height + 1) / TILE_SIZE; ++y) {
        const mapX = x + centerOffset.x;
        const mapY = y + centerOffset.y;
        const spatialHash = hash(mapX, mapY);

        const position = {
          top: (y * TILE_SIZE - characterTileOffset.y) / ctx.screen.height,
          left: (x * TILE_SIZE - characterTileOffset.x) / ctx.screen.width,
          bottom:
            (y * TILE_SIZE + TILE_SIZE - characterTileOffset.y) /
            ctx.screen.height,
          right:
            (x * TILE_SIZE + TILE_SIZE - characterTileOffset.x) /
            ctx.screen.width,
        };

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

    const offset = {
      x: state.character.animator.getSprite().width / 2,
      y: state.character.animator.getSprite().height / 2,
    };
    state.character.animator.draw(s, {
      top: Math.floor(ctx.screen.height / 2 - offset.y) / ctx.screen.height,
      left: Math.floor(ctx.screen.width / 2 - offset.x) / ctx.screen.width,
      bottom: Math.floor(ctx.screen.height / 2 + offset.y) / ctx.screen.height,
      right: Math.floor(ctx.screen.width / 2 + offset.x) / ctx.screen.width,
    });
  });
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
  if (ctx.keys["w"] || ctx.keys["ArrowUp"]) {
    direction.up = true;
  }
  if (ctx.keys["s"] || ctx.keys["ArrowDown"]) {
    direction.down = true;
  }
  if (ctx.keys["a"] || ctx.keys["ArrowLeft"]) {
    direction.left = true;
  }
  if (ctx.keys["d"] || ctx.keys["ArrowRight"]) {
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
