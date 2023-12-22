import {
  GPUTexture,
  GameContext,
  InstanceBuffer,
  Quad,
  ShaderProgram,
  SpriteAnimator,
  SpriteEffect,
  SpriteSheet,
  SpriteSheetConfig,
  SpriteViewProjection,
  TEXTURE,
  loadTextureFromUrl,
  glm,
} from "@pixelheart/client";

import fragmentShader from "./shaders/sprite.frag";
import vertexShader from "./shaders/sprite.vert";

export type SimpleSpriteTextures = GPUTexture;
export type SimpleSpriteSheet = SpriteSheet<SimpleSpriteTextures>;
export class SimpleSpriteAnimator extends SpriteAnimator<SimpleSpriteTextures> { }

export async function simpleTextureLoader(
  ctx: GameContext,
  sheet: SpriteSheetConfig
): Promise<SimpleSpriteTextures> {
  return await loadTextureFromUrl(ctx, sheet.urls.diffuse);
}

type SpriteInstance = {
  mvp: glm.mat3;
  uv: glm.mat3;
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

  draw(rect: glm.ReadonlyVec4, textureCoords: glm.ReadonlyVec4): SimpleSpriteEffect {
    if (this.#texture) {
      const mvp = glm.mat3.create();
      glm.mat3.translate(mvp, mvp, [rect[3], rect[0]]);
      glm.mat3.scale(mvp, mvp, [rect[1] - rect[3], rect[2] - rect[0]]);
      glm.mat3.multiply(mvp, SpriteViewProjection, mvp);

      const uv = glm.mat3.create();
      glm.mat3.translate(uv, uv, [
        textureCoords[3] / this.#texture.width,
        textureCoords[0] / this.#texture.height,
      ]);
      glm.mat3.scale(uv, uv, [
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
