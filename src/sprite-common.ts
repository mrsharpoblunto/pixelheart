import { vec4, ReadonlyVec4 } from "gl-matrix";
import { GameContext } from "./api";
import { SpriteSheetConfig } from "./sprite-format";

export interface Sprite<T> {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly frames: Array<ReadonlyVec4>;
  draw(
    effect: SpriteEffect<T>,
    position: ReadonlyVec4,
    frame?: number
  ): Sprite<T>;
}

export interface SpriteSheet<T> extends Record<string, Sprite<T>> {}

export interface SpriteEffect<T> {
  setTextures(texture: T): SpriteEffect<T>;
  draw(rect: ReadonlyVec4, textureCoords: ReadonlyVec4): SpriteEffect<T>;
}

let devSprites: Map<
  string,
  {
    config: SpriteSheetConfig;
    reloaders: Array<(config: SpriteSheetConfig) => void>;
  }
> | null = null;

function registerSprite(
  spriteSheet: SpriteSheetConfig,
  reload: (config: SpriteSheetConfig) => void
) {
  if (process.env.NODE_ENV === "development") {
    if (!devSprites) {
      devSprites = new Map();
    }
    const sprite = devSprites.get(spriteSheet.name);
    if (!sprite) {
      devSprites.set(spriteSheet.name, {
        config: spriteSheet,
        reloaders: [reload],
      });
    } else {
      sprite.reloaders.push(reload);
    }
  }
}

export function reloadSprite(spriteSheet: SpriteSheetConfig) {
  if (process.env.NODE_ENV === "development" && devSprites) {
    const sprite = devSprites.get(spriteSheet.name);
    if (sprite) {
      // rebuild the sprite config but maintain the same object reference
      Object.keys(sprite.config).forEach(
        (k) => delete sprite.config[k as keyof SpriteSheetConfig]
      );
      Object.assign(sprite.config, spriteSheet);

      for (let reload of sprite.reloaders) {
        reload(spriteSheet);
      }
    }
  }
}

export async function loadSpriteSheet<T>(
  ctx: GameContext,
  sheet: SpriteSheetConfig,
  loader: (ctx: GameContext, sheet: SpriteSheetConfig) => Promise<T>
): Promise<SpriteSheet<T>> {
  const textures = await loader(ctx, sheet);
  const value = createSpriteFrames(sheet, textures);
  registerSprite(sheet, (newSheet) => {
    Object.keys(value).forEach((k) => delete value[k]);
    Object.assign(value, createSpriteFrames(newSheet, textures));
  });
  return value;
}

function createSpriteFrames<T>(sheet: SpriteSheetConfig, textures: T) {
  return Object.keys(sheet.sprites).reduce(
    (p: Record<string, Sprite<T>>, n: string) => {
      const sprite = sheet.sprites[n];
      const frames = sprite.frames.map((f) =>
        vec4.fromValues(f.top, f.right, f.bottom, f.left)
      );
      p[n] = {
        index: sprite.index,
        width: sprite.width,
        height: sprite.height,
        frames,
        draw: (
          effect: SpriteEffect<T>,
          position: ReadonlyVec4,
          frame: number = 0
        ) => {
          effect.setTextures(textures);
          effect.draw(position, frames[Math.floor(frame) % frames.length]);
          return p[n];
        },
      };
      return p;
    },
    {}
  );
}

export class SpriteAnimator<T> {
  #sheet: SpriteSheet<T>;
  #sprite: Sprite<T>;
  #spriteName: string;
  frameRate: number;
  frame: number;

  constructor(spriteSheet: SpriteSheet<T>, sprite: string, frameRate: number) {
    this.frameRate = frameRate;
    this.frame = 0;
    this.#sheet = spriteSheet;
    this.#spriteName = sprite;
    this.#sprite = spriteSheet[sprite];
  }

  tick(fixedDelta: number): void {
    this.frame += fixedDelta * this.frameRate;
    if (this.frame > this.#sprite.frames.length) {
      this.frame -= this.#sprite.frames.length;
    }
  }

  getSprite(): Sprite<T> {
    return this.#sprite;
  }

  getSpriteName(): string {
    return this.#spriteName;
  }

  setSprite(sprite: string) {
    const newSprite = this.#sheet[sprite];
    if (newSprite !== this.#sprite) {
      this.#sprite = newSprite;
      this.#spriteName = sprite;
      this.frame = 0;
    }
  }

  setSpriteOrTick(sprite: string, fixedDelta: number) {
    const newSprite = this.#sheet[sprite];
    if (newSprite !== this.#sprite) {
      this.#sprite = newSprite;
      this.#spriteName = sprite;
      this.frame = 0;
    } else {
      this.tick(fixedDelta);
    }
  }

  draw(effect: SpriteEffect<T>, position: ReadonlyVec4, offset: number = 0) {
    this.#sprite.draw(effect, position, this.frame + offset);
  }
}
