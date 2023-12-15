import { ReadonlyVec4, mat3 } from "gl-matrix";

import { GameContext } from "../api";
import { Quad, SpriteViewProjection } from "../geometry";
import { InstanceBuffer, ShaderProgram } from "../gl-utils";
import { GPUTexture, TEXTURE, loadTextureFromUrl } from "../images";
import {
  SpriteAnimator,
  SpriteEffect,
  SpriteSheet,
  SpriteSheetConfig,
} from "../sprite";

import fragmentShader from "../shaders/sprite.frag";
import vertexShader from "../shaders/sprite.vert";

export type SimpleSpriteTextures = GPUTexture;
export type SimpleSpriteSheet = SpriteSheet<SimpleSpriteTextures>;
export class SimpleSpriteAnimator extends SpriteAnimator<SimpleSpriteTextures> {}

export async function simpleTextureLoader(
  ctx: GameContext,
  sheet: SpriteSheetConfig
): Promise<SimpleSpriteTextures> {
  return await loadTextureFromUrl(ctx, sheet.urls.diffuse);
}

type SpriteInstance = {
  mvp: mat3;
  uv: mat3;
  alpha: number;
};

export class SimpleSpriteEffect implements SpriteEffect<SimpleSpriteTextures> {
  #gl: WebGL2RenderingContext;
  #program: ShaderProgram<typeof vertexShader, typeof fragmentShader>;
  #instanceBuffer: InstanceBuffer<typeof vertexShader, SpriteInstance>;
  #quad: Quad;
  #texture: GPUTexture | null;
  #pending: Array<SpriteInstance>;
  #alpha: number;

  constructor(ctx: GameContext) {
    this.#gl = ctx.gl;
    this.#program = new ShaderProgram(ctx, vertexShader, fragmentShader)!;
    this.#instanceBuffer = new InstanceBuffer(this.#gl, this.#program, {
      a_mvp: (instance) => instance.mvp,
      a_uv: (instance) => instance.uv,
      a_alpha: (instance) => instance.alpha,
    });
    this.#quad = new Quad(this.#gl);
    this.#pending = [];
    this.#texture = null;
    this.#alpha = 1.0;
  }

  use(scope: (s: SimpleSpriteEffect) => void) {
    this.#program.use(() => {
      this.#alpha = 1.0;
      scope(this);
      this.#end();
    });
  }

  setTextures(param: SimpleSpriteTextures): SimpleSpriteEffect {
    if (param === this.#texture) {
      return this;
    } else if (this.#pending.length) {
      this.#end();
    }

    this.#texture = param;
    this.#program.setUniforms({
      u_texture: param[TEXTURE],
    });
    return this;
  }

  setAlpha(alpha: number): SimpleSpriteEffect {
    this.#alpha = alpha;
    return this;
  }

  draw(rect: ReadonlyVec4, textureCoords: ReadonlyVec4): SimpleSpriteEffect {
    if (this.#texture) {
      const mvp = mat3.create();
      mat3.translate(mvp, mvp, [rect[3], rect[0]]);
      mat3.scale(mvp, mvp, [rect[1] - rect[3], rect[2] - rect[0]]);
      mat3.multiply(mvp, SpriteViewProjection, mvp);

      const uv = mat3.create();
      mat3.translate(uv, uv, [
        textureCoords[3] / this.#texture.width,
        textureCoords[0] / this.#texture.height,
      ]);
      mat3.scale(uv, uv, [
        (textureCoords[1] - textureCoords[3]) / this.#texture.width,
        (textureCoords[2] - textureCoords[0]) / this.#texture.height,
      ]);

      this.#pending.push({ mvp, uv, alpha: this.#alpha });
    }
    return this;
  }

  #end() {
    this.#quad.bindInstances(
      this.#program,
      { position: "a_position" },
      this.#instanceBuffer.load(this.#pending),
      (q) => {
        q.draw();
      }
    );
    this.#pending = [];
    this.#texture = null;
  }
}
