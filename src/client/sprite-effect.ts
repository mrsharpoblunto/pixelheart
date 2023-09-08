import { ReadonlyVec4, mat3 } from "gl-matrix";
import { GPUTexture, TEXTURE } from "./images";
import { GameContext } from "./game-runner";
import { loadTextureFromUrl } from "./images";
import {
  SpriteSheet,
  SpriteAnimator,
  SpriteSheetConfig,
  SpriteEffect,
} from "./sprite-common";
import { Quad } from "./geometry";
import { ShaderProgram, createProgram, InstanceBuffer } from "./gl-utils";
import vertexShader from "./shaders/sprite.vert";
import fragmentShader from "./shaders/sprite.frag";

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
};

export class SimpleSpriteEffect implements SpriteEffect<SimpleSpriteTextures> {
  #gl: WebGL2RenderingContext;
  #program: ShaderProgram<typeof vertexShader, typeof fragmentShader>;
  #instanceBuffer: InstanceBuffer<typeof vertexShader, SpriteInstance>;
  #quad: Quad;
  #texture: GPUTexture | null;
  #vp: mat3;
  #pending: Array<SpriteInstance>;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.#program = createProgram(this.#gl, vertexShader, fragmentShader)!;
    this.#instanceBuffer = new InstanceBuffer(this.#gl, this.#program, [
      ["a_mvp", (instance) => instance.mvp],
      ["a_uv", (instance) => instance.uv],
    ]);
    this.#quad = new Quad(this.#gl);
    this.#pending = [];
    this.#texture = null;

    this.#vp = mat3.create();
    mat3.scale(this.#vp, this.#vp, [1.0, -1.0]);
    mat3.translate(this.#vp, this.#vp, [-1.0, -1.0]);
    mat3.scale(this.#vp, this.#vp, [2.0, 2.0]);
  }

  use(scope: (s: SimpleSpriteEffect) => void) {
    this.#gl.useProgram(this.#program.program);
    scope(this);
    this.#end();
  }

  setTextures(param: SimpleSpriteTextures): SimpleSpriteEffect {
    if (param === this.#texture) {
      return this;
    } else if (this.#pending.length) {
      this.#end();
    }

    this.#texture = param;
    // Bind the texture to texture unit 0
    this.#gl.activeTexture(this.#gl.TEXTURE0);
    this.#gl.bindTexture(this.#gl.TEXTURE_2D, param[TEXTURE]);
    this.#gl.uniform1i(this.#program.uniforms.u_texture, 0);
    return this;
  }

  draw(rect: ReadonlyVec4, textureCoords: ReadonlyVec4): SimpleSpriteEffect {
    if (this.#texture) {
      const mvp = mat3.create();
      mat3.translate(mvp, mvp, [rect[3], rect[0]]);
      mat3.scale(mvp, mvp, [rect[1] - rect[3], rect[2] - rect[0]]);
      mat3.multiply(mvp, this.#vp, mvp);

      const uv = mat3.create();
      mat3.translate(uv, uv, [
        textureCoords[3] / this.#texture.width,
        textureCoords[0] / this.#texture.height,
      ]);
      mat3.scale(uv, uv, [
        (textureCoords[1] - textureCoords[3]) / this.#texture.width,
        (textureCoords[2] - textureCoords[0]) / this.#texture.height,
      ]);

      this.#pending.push({ mvp, uv });
    }
    return this;
  }

  #end() {
    this.#instanceBuffer.load(this.#pending).bind(this.#program, (instanceCount) => {
      this.#quad.bind(this.#program, "a_position", (geometry) => {
        geometry.drawInstanced(instanceCount);
      });
    });
    this.#pending = [];
    this.#texture = null;
  }
}
