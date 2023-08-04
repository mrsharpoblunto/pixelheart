import { RenderContext } from "./game-runner";
import {
  CPUReadableTexture,
  loadCPUReadableTextureFromUrl,
  loadTextureFromUrl,
} from "./images";
import { Character, Sprite } from "./character";
import {
  SpriteSheet,
  loadSpriteSheet,
  SpriteAnimator,
  SpriteEffect,
} from "./sprite-effect";
import overworldSprite from "./sprites/overworld";

const CONTROLLER_DEADZONE = 0.25;

export interface GameState {
  spriteEffect: SpriteEffect;
  map: CPUReadableTexture;
  overworld: SpriteSheet;
  character: Character;
  selectedGamepadIndex: number | null;
  keys: { [key: string]: boolean };
  world: { width: number; height: number };
  water: SpriteAnimator;
}

export async function onInit(
  ctx: RenderContext,
  world: { width: number; height: number }
): Promise<GameState> {
  const overworld = await loadSpriteSheet(ctx, overworldSprite);
  const state: GameState = {
    spriteEffect: new SpriteEffect(ctx.gl),
    map: await loadCPUReadableTextureFromUrl(ctx, "/images/walkmap.png"),
    overworld: overworld,
    character: {
      sprite: Sprite,
      texture: await loadTextureFromUrl(ctx, "/images/character.png"),
      direction: "down",
      currentFrame: 0,
      frameRate: 8 / 1000,
      position: { x: world.width / 2 + 50, y: world.height / 2 },
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
  const frame = Math.floor(state.character.currentFrame);
  const anim =
    state.character.sprite.animations[state.character.direction][frame];
  const offset = {
    x: (anim.right - anim.left) / 2,
    y: (anim.bottom - anim.top) / 2,
  };

  ctx.gl.enable(ctx.gl.BLEND);
  ctx.gl.blendFunc(ctx.gl.SRC_ALPHA, ctx.gl.ONE_MINUS_SRC_ALPHA);

  state.spriteEffect.use((s) => {
    const xAdjust = Math.floor(state.character.position.x) % 16;
    const yAdjust = Math.floor(state.character.position.y) % 16;
    const xOffset =
      Math.floor(state.character.position.x / 16) -
      state.world.width / (16 * 2);
    const yOffset =
      Math.floor(state.character.position.y / 16) -
      state.world.height / (16 * 2);

    for (let x = -1; x < (state.world.width + 1) / 16; ++x) {
      for (let y = -1; y < (state.world.height + 1) / 16; ++y) {
        const mapX = x + xOffset;
        const mapY = y + yOffset;
        const spatialHash = hash(mapX, mapY);

        const position = {
          top: (y * 16 - yAdjust) / state.world.height,
          left: (x * 16 - xAdjust) / state.world.width,
          bottom: (y * 16 + 16 - yAdjust) / state.world.height,
          right: (x * 16 + 16 - xAdjust) / state.world.width,
        };

        if (ctx.offscreen.getImageData(mapX, mapY, 1, 1).data[0] === 0) {
          // water
          state.overworld.water.draw(
            s,
            position,
            state.water.getFrame() + spatialHash
          );
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
          } else {
            state.overworld.grass.draw(s, position, spatialHash);
          }
          /**
           * TODO load in these tiles...
          } else if (top && right) {
            tileOffset = { top: 144, left: 48, bottom: 160, right: 64 };
          } else if (top && !left && !right) {
            tileOffset = { top: 128, left: 48, bottom: 144, right: 64 };
          } else if (topLeft && !left && !top) {
            tileOffset = { top: 128, left: 64, bottom: 144, right: 80 };
          } else if (topRight && !right && !top) {
            tileOffset = { top: 128, left: 32, bottom: 144, right: 48 };
          } else if (left && !top && !bottom) {
            tileOffset = { top: 112, left: 64, bottom: 128, right: 80 };
          } else if (bottom && left) {
            tileOffset = { top: 160, left: 32, bottom: 176, right: 48 };
          } else if (bottom && right) {
            tileOffset = { top: 160, left: 48, bottom: 176, right: 64 };
          } else if (bottom && !left && !right) {
            tileOffset = { top: 96, left: 48, bottom: 112, right: 64 };
          } else if (bottomLeft && !left && !bottom) {
            tileOffset = { top: 96, left: 64, bottom: 112, right: 80 };
          } else if (bottomRight && !right && !bottom) {
            tileOffset = { top: 96, left: 32, bottom: 112, right: 48 };
          } else if (right && !top && !bottom) {
            tileOffset = { top: 112, left: 32, bottom: 128, right: 48 };
          } else {
          **/
        }
      }
    }

    s.setTexture(state.character.texture);
    s.draw(
      {
        top: Math.floor(state.world.height / 2 - offset.y) / state.world.height,
        left: Math.floor(state.world.width / 2 - offset.x) / state.world.width,
        bottom:
          Math.floor(state.world.height / 2 + offset.y) / state.world.height,
        right: Math.floor(state.world.width / 2 + offset.x) / state.world.width,
        /**
        top: Math.floor(state.character.position.y - offset.y) / state.world.height,
        left: Math.floor(state.character.position.x - offset.x ) / state.world.width,
        bottom: Math.floor(state.character.position.y + offset.y ) / state.world.height,
        right: Math.floor(state.character.position.x + offset.x ) / state.world.width,
        */
      },
      { top: anim.top, left: anim.left, bottom: anim.bottom, right: anim.right }
    );
  });
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

  let newDirection: string | null = null;
  // direction animations are mutually exclusive
  if (direction.left) {
    newDirection = "left";
  } else if (direction.right) {
    newDirection = "right";
  } else if (direction.up) {
    newDirection = "up";
  } else if (direction.down) {
    newDirection = "down";
  }

  if (newDirection) {
    if (newDirection !== state.character.direction) {
      state.character.currentFrame = 0;
      state.character.direction = newDirection;
    } else {
      state.character.currentFrame += fixedDelta * state.character.frameRate;
      if (
        Math.floor(state.character.currentFrame) >=
        state.character.sprite.animations[newDirection].length
      ) {
        state.character.currentFrame = 0;
      }
    }
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

  // Draw the walkmap offscreen
  //ctx.offscreen.drawImage(state.map.image, 0, 0, state.map.width, state.map.height);

  const newPositionX = state.character.position.x + movement.x;
  const newPositionY = state.character.position.y + movement.y;
  const isWater = false; // ctx.offscreen.getImageData(newPositionX / 16, newPositionY / 16, 1, 1).data[0]===0;

  if (newPositionX < state.map.width * 16 && newPositionX >= 0 && !isWater) {
    state.character.position.x = newPositionX;
  }
  if (newPositionY < state.map.height * 16 && newPositionY >= 0 && !isWater) {
    state.character.position.y = newPositionY;
  }
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
