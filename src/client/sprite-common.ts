import { vec4, ReadonlyVec4 } from "gl-matrix";
import { GameContext } from "./game-runner";
import { SpriteSheetConfig } from "../shared/sprite-format";

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

export async function loadSpriteSheet<T>(
  ctx: GameContext,
  sheet: SpriteSheetConfig,
  loader: (ctx: GameContext, sheet: SpriteSheetConfig) => Promise<T>
): Promise<SpriteSheet<T>> {
  const textures = await loader(ctx, sheet);
  const value = createSpriteFrames(sheet, textures);
  if (process.env.NODE_ENV === "development") {
    if (ctx.editor) {
      ctx.editor.onEvent((event) => {
        if (
          event.type === "RELOAD_SPRITESHEET" &&
          event.spriteSheet.name === sheet.name
        ) {
          Object.assign(value, createSpriteFrames(event.spriteSheet, textures));
          console.log(`Reloaded ${sheet.name} sprite metadata`);
        }
      });
    }
  }
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

export type SpriteIndex = Array<{
  readonly sprite: string;
  readonly index: number;
  readonly frames: Array<ReadonlyVec4>;
}>;

export function createSpriteIndex(sheet: SpriteSheetConfig): SpriteIndex {
  return sheet.indexes.map((s: string, i: number) => {
    return i == 0
      ? { sprite: "", index: i, frames: [] }
      : {
          sprite: s,
          index: i,
          frames: sheet.sprites[s].frames.map((f) =>
            vec4.fromValues(f.top, f.right, f.bottom, f.left)
          ),
        };
  });
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
