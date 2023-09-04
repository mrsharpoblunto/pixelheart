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
import vertexShaderSource from "./shaders/sprite.vert";
import fragmentShaderSource from "./shaders/sprite.frag";

export type SimpleSpriteTextures = GPUTexture;
export type SimpleSpriteSheet = SpriteSheet<SimpleSpriteTextures>;
export class SimpleSpriteAnimator extends SpriteAnimator<SimpleSpriteTextures> {}

export async function simpleTextureLoader(
  ctx: GameContext,
  sheet: SpriteSheetConfig
): Promise<SimpleSpriteTextures> {
  return await loadTextureFromUrl(ctx, sheet.urls.diffuse);
}

export class SimpleSpriteEffect implements SpriteEffect<SimpleSpriteTextures> {
  #gl: WebGL2RenderingContext;
  #program: WebGLProgram;
  #a_position: number;
  #u_texture: WebGLUniformLocation;
  #a_uv: number;
  #a_mvp: number;
  #texture: GPUTexture | null;
  #vertexBuffer: WebGLBuffer;
  #vp: mat3;
  #pending: Array<{ mvp: mat3; uv: mat3 }>;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;

    const vertexShader = this.#gl.createShader(this.#gl.VERTEX_SHADER)!;
    this.#gl.shaderSource(vertexShader, vertexShaderSource);
    this.#gl.compileShader(vertexShader);

    const fragmentShader = this.#gl.createShader(this.#gl.FRAGMENT_SHADER)!;
    this.#gl.shaderSource(fragmentShader, fragmentShaderSource);
    this.#gl.compileShader(fragmentShader);

    this.#program = this.#gl.createProgram()!;
    this.#gl.attachShader(this.#program, vertexShader);
    this.#gl.attachShader(this.#program, fragmentShader);
    this.#gl.linkProgram(this.#program);
    if (!this.#gl.getProgramParameter(this.#program, this.#gl.LINK_STATUS)) {
      console.log(this.#gl.getShaderInfoLog(vertexShader));
      console.log(this.#gl.getShaderInfoLog(fragmentShader));
    }

    this.#a_position = this.#gl.getAttribLocation(this.#program, "a_position");
    this.#u_texture = gl.getUniformLocation(this.#program, "u_texture")!;
    this.#a_uv = gl.getAttribLocation(this.#program, "a_uv")!;
    this.#a_mvp = gl.getAttribLocation(this.#program, "a_mvp")!;

    const vertices = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    this.#vertexBuffer = this.#gl.createBuffer()!;
    this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, this.#vertexBuffer);
    this.#gl.bufferData(this.#gl.ARRAY_BUFFER, vertices, this.#gl.STATIC_DRAW);

    this.#vp = mat3.create();
    mat3.scale(this.#vp, this.#vp, [1.0, -1.0]);
    mat3.translate(this.#vp, this.#vp, [-1.0, -1.0]);
    mat3.scale(this.#vp, this.#vp, [2.0, 2.0]);

    this.#pending = [];
    this.#texture = null;
  }

  use(scope: (s: SimpleSpriteEffect) => void) {
    this.#gl.useProgram(this.#program);
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
    this.#gl.uniform1i(this.#u_texture, 0);
    this.#gl.texParameteri(
      this.#gl.TEXTURE_2D,
      this.#gl.TEXTURE_MAG_FILTER,
      this.#gl.NEAREST
    );
    this.#gl.texParameteri(
      this.#gl.TEXTURE_2D,
      this.#gl.TEXTURE_MIN_FILTER,
      this.#gl.NEAREST
    );
    this.#gl.texParameteri(this.#gl.TEXTURE_2D, this.#gl.TEXTURE_BASE_LEVEL, 0);
    this.#gl.texParameteri(this.#gl.TEXTURE_2D, this.#gl.TEXTURE_MAX_LEVEL, 2);
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
    const b = new Float32Array(this.#pending.length * 9 * 2);
    let offset = 0;
    for (let i = 0; i < this.#pending.length; ++i) {
      b.set(this.#pending[i].mvp, offset);
      offset += 9;
      b.set(this.#pending[i].uv, offset);
      offset += 9;
    }
    const instanceBuffer = this.#gl.createBuffer();
    this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, instanceBuffer);
    this.#gl.bufferData(this.#gl.ARRAY_BUFFER, b, this.#gl.STATIC_DRAW);

    this.#gl.enableVertexAttribArray(this.#a_mvp);
    this.#gl.vertexAttribPointer(
      this.#a_mvp,
      3,
      this.#gl.FLOAT,
      false,
      9 * 4 * 2,
      0 * 3 * 4
    );
    this.#gl.vertexAttribDivisor(this.#a_mvp, 1);
    this.#gl.enableVertexAttribArray(this.#a_mvp + 1);
    this.#gl.vertexAttribPointer(
      this.#a_mvp + 1,
      3,
      this.#gl.FLOAT,
      false,
      9 * 4 * 2,
      1 * 3 * 4
    );
    this.#gl.vertexAttribDivisor(this.#a_mvp + 1, 1);
    this.#gl.enableVertexAttribArray(this.#a_mvp + 2);
    this.#gl.vertexAttribPointer(
      this.#a_mvp + 2,
      3,
      this.#gl.FLOAT,
      false,
      9 * 4 * 2,
      2 * 3 * 4
    );
    this.#gl.vertexAttribDivisor(this.#a_mvp + 2, 1);

    this.#gl.enableVertexAttribArray(this.#a_uv);
    this.#gl.vertexAttribPointer(
      this.#a_uv,
      3,
      this.#gl.FLOAT,
      false,
      9 * 4 * 2,
      3 * 3 * 4
    );
    this.#gl.vertexAttribDivisor(this.#a_uv, 1);
    this.#gl.enableVertexAttribArray(this.#a_uv + 1);
    this.#gl.vertexAttribPointer(
      this.#a_uv + 1,
      3,
      this.#gl.FLOAT,
      false,
      9 * 4 * 2,
      4 * 3 * 4
    );
    this.#gl.vertexAttribDivisor(this.#a_uv + 1, 1);
    this.#gl.enableVertexAttribArray(this.#a_uv + 2);
    this.#gl.vertexAttribPointer(
      this.#a_uv + 2,
      3,
      this.#gl.FLOAT,
      false,
      9 * 4 * 2,
      5 * 3 * 4
    );
    this.#gl.vertexAttribDivisor(this.#a_uv + 2, 1);

    this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, this.#vertexBuffer);
    this.#gl.enableVertexAttribArray(this.#a_position);
    this.#gl.vertexAttribPointer(
      this.#a_position,
      2,
      this.#gl.FLOAT,
      false,
      0,
      0
    );

    this.#gl.drawArraysInstanced(
      this.#gl.TRIANGLE_STRIP,
      0,
      4,
      this.#pending.length
    );
    this.#pending = [];
    this.#texture = null;
  }
}
