import { RenderContext } from "./game-runner";
import { CPUReadableTexture, loadCPUReadableTextureFromUrl, loadTextureFromUrl } from "./images";
import { Character, Sprite } from "./character";
import SpriteEffect from "./sprite-effect";

const CONTROLLER_DEADZONE = 0.25;

export interface GameState {
  spriteEffect: SpriteEffect;
  map: CPUReadableTexture;
  character: Character;
  selectedGamepadIndex: number | null;
  keys: {[key: string]: boolean };
  world: {width: number, height: number};
}

export async function onInit(ctx: RenderContext, world: {width: number, height: number}): Promise<GameState> {
  const state: GameState = {
    spriteEffect: new SpriteEffect(ctx.gl),
    map: await loadCPUReadableTextureFromUrl(ctx, "/images/overworld.png"),
    character: {
      sprite: Sprite,
      texture: await loadTextureFromUrl(ctx, "/images/character.png"),
      direction: 'down',
      currentFrame: 0,
      frameRate: 8 / 1000,
      position: { x: world.width / 2, y: world.height / 2 },
      speed: 1,
    },
    world,
    selectedGamepadIndex: null,
    keys: {},
  };

  window.addEventListener('gamepadconnected', (e) => {
    state.selectedGamepadIndex = e.gamepad.index;
  });
  window.addEventListener('gamepaddisconnected', (_) => {
    state.selectedGamepadIndex = null;
  });
  window.addEventListener('keydown', (e) => {
    state.keys[e.key] = true;
  });
  window.addEventListener('keyup', (e) => {
    delete state.keys[e.key];
  });

  return state;
}

export function onDraw(_ctx: RenderContext, state: GameState, _delta: number) {

  const frame = Math.floor(state.character.currentFrame);
  const anim = state.character.sprite.animations[state.character.direction][frame];
  const offset = { x: (anim.right - anim.left) / 2, y: (anim.bottom - anim.top) / 2 };

  state.spriteEffect
    .bind()
    .setTexture(state.character.texture, state.character.sprite.width, state.character.sprite.height)
    .draw(
      {
        top: Math.floor(state.character.position.y - offset.y) / state.world.height,
        left: Math.floor(state.character.position.x - offset.x ) / state.world.width,
        bottom: Math.floor(state.character.position.y + offset.y ) / state.world.height,
        right: Math.floor(state.character.position.x + offset.x ) / state.world.width,
      },
      { top: anim.top, left: anim.left, bottom: anim.bottom, right: anim.right }
    );
}

export function onUpdate(
  _ctx: RenderContext,
  state: GameState,
  fixedDelta: number
) {

  const direction: {[key: string]: boolean} = {};
  // gamepad input
  if (state.selectedGamepadIndex!==null) {
    const gp = navigator.getGamepads()[state.selectedGamepadIndex];
    if (gp) {
      if ((gp.buttons[12].pressed) || Math.min(0.0, gp.axes[1] + CONTROLLER_DEADZONE) < 0) {
        direction.up = true;
      }
      if ((gp.buttons[13].pressed) || Math.max(0.0, gp.axes[1] - CONTROLLER_DEADZONE) > 0) {
        direction.down = true;
      }
      if ((gp.buttons[14].pressed) || Math.min(0.0, gp.axes[0] + CONTROLLER_DEADZONE) < 0) {
        direction.left = true;
      }
      if ((gp.buttons[15].pressed) || Math.max(0.0, gp.axes[0] - CONTROLLER_DEADZONE) > 0) {
        direction.right = true;
      }
    }
  }
  // keyboard input
  if (state.keys['w'] || state.keys['ArrowUp']) {
    direction.up = true;
  }
  if (state.keys['s'] || state.keys['ArrowDown']) {
    direction.down = true;
  }
  if (state.keys['a'] || state.keys['ArrowLeft']) {
    direction.left = true;
  }
  if (state.keys['d'] || state.keys['ArrowRight']) {
    direction.right = true;
  }

  let newDirection: string | null = null;
  // direction animations are mutually exclusive
  if (direction.left) {
    newDirection = 'left';
  } else if (direction.right) {
    newDirection = 'right';
  } else if (direction.up) {
     newDirection = 'up';
  } else if (direction.down) {
      newDirection = 'down';
  }

  if (newDirection) {
    if (newDirection !== state.character.direction) {
      state.character.currentFrame = 0;
      state.character.direction = newDirection;
    } else {
      state.character.currentFrame += fixedDelta * state.character.frameRate;
      if (Math.floor(state.character.currentFrame) >= state.character.sprite.animations[newDirection].length) {
        state.character.currentFrame = 0;
      }
    }
  }

  // but movement is not 
  const movement = { x: 0, y: 0};
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
  state.character.position.x += movement.x;
  state.character.position.y += movement.y;
}

function normalizeVector(v: {x: number, y: number}) {
  const length = Math.sqrt(v.x * v.x + v.y * v.y);
  if (length === 0) {
    v.x = 0;
    v.y = 0;
  } else {
    v.x /= length;
    v.y /= length;
  }
}
