import { ReadonlyVec4, mat3, vec3, vec4 } from "gl-matrix";

import { GameContext } from "./api";

export interface SpriteConfig {
  readonly width: number;
  readonly height: number;
  readonly index: number;
  readonly frames: Array<{
    readonly top: number;
    readonly left: number;
    readonly bottom: number;
    readonly right: number;
  }>;
}

export interface SpriteSheetConfig {
  name: string;
  urls: {
    diffuse: string;
    normal: string;
    specular: string;
    emissive: string;
  };
  indexes: Array<string>;
  sprites: Record<string, SpriteConfig>;
}

export const Tangent = vec3.set(vec3.create(), 0, 1, 0);
export const Normal = vec3.set(vec3.create(), 0, 0, 1);
export const Binormal = vec3.cross(vec3.create(), Tangent, Normal);

export const TBN = mat3.set(
  mat3.create(),
  Tangent[0],
  Binormal[0],
  Normal[0],
  Tangent[1],
  Binormal[1],
  Normal[1],
  Tangent[2],
  Binormal[2],
  Normal[2]
);

export const ToTangentSpace = mat3.transpose(mat3.create(), TBN);

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

export interface SpriteSheet<T> extends Record<string, Sprite<T>> { }

export interface SpriteEffect<T> {
  setTextures(texture: T): SpriteEffect<T>;
  draw(rect: ReadonlyVec4, textureCoords: ReadonlyVec4): SpriteEffect<T>;
}

function getSpriteState(): Map<
  string,
  {
    config: SpriteSheetConfig;
    reloaders: Array<(config: SpriteSheetConfig) => void>;
  }
> | null {
  return process.env.NODE_ENV === "development"
    ? // @ts-ignore
    window.__PIXELHEART_SPRITE_STATE__ ||
     // @ts-ignore
      (window.__PIXELHEART_SPRITE_STATE__ = new Map())
      : null;
}

function registerSprite(
  spriteSheet: SpriteSheetConfig,
  reload: (config: SpriteSheetConfig) => void
) {
  const devSprites = getSpriteState();
  if (devSprites) {
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
  const devSprites = getSpriteState();
  if (devSprites) {
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
