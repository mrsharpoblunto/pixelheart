import { mat3 } from "gl-matrix";
import { TEXTURE, loadTextureFromUrl } from "./images";
import { RenderContext } from "./game-runner";

const vertexShaderSource = `#version 300 es

  in vec2 a_position;

  in mat3 a_uv;
  in mat3 a_mvp;

  out vec2 v_texCoord;

  void main() {
    vec3 uvPosition = a_uv * vec3(a_position, 1.0);
    vec3 clipPosition = a_mvp * vec3(a_position, 1.0);

    v_texCoord = uvPosition.xy;
    gl_Position = vec4(clipPosition.xy, 0.0, 1.0);
  }
`;

const fragmentShaderSource = `#version 300 es

  precision mediump float;

  in vec2 v_texCoord;

  uniform sampler2D u_texture;

  out vec4 outColor;

  void main() {
    outColor = texture(u_texture, v_texCoord);
  }
`;

export interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface SpriteConfig {
  width: number;
  height: number;
  frames: Array<{
    top: number;
    left: number;
    bottom: number;
    right: number;
  }>;
}

export interface Sprite extends SpriteConfig {
  draw(effect: SpriteEffect, position: Rect, frame?: number): void;
}

export interface SpriteSheetConfig {
  url: string;
  sprites: Record<string, SpriteConfig>;
}

export interface SpriteSheet extends Record<string, Sprite> {}

export async function loadSpriteSheet(
  ctx: RenderContext,
  sheet: SpriteSheetConfig
): Promise<SpriteSheet> {
  const texture = await loadTextureFromUrl(ctx, sheet.url);
  return {
    ...Object.keys(sheet.sprites).reduce(
      (p: Record<string, Sprite>, n: string) => {
        const sprite = sheet.sprites[n];
        p[n] = {
          ...sprite,
          draw: (effect: SpriteEffect, position: Rect, frame: number = 0) => {
            effect.setTexture(texture);
            effect.draw(position, sprite.frames[frame % sprite.frames.length]);
          },
        };
        return p;
      },
      {}
    ),
  };
}

export class SpriteAnimator {
  #frameRate: number;
  #sprite: Sprite;
  #frame: number;

  constructor(sprite: Sprite, frameRate: number) {
    this.#sprite = sprite;
    this.#frameRate = frameRate;
    this.#frame = 0;
  }

  tick(fixedDelta: number): void {
    this.#frame += fixedDelta * this.#frameRate;
    if (this.#frame > this.#sprite.frames.length) {
      this.#frame -= this.#sprite.frames.length;
    }
  }

  getFrame(): number {
    return Math.floor(this.#frame);
  }

  reset() {
    this.#frame = 0;
  }
}

export class SpriteEffect {
  #gl: WebGL2RenderingContext;
  #program: WebGLProgram;
  #a_position: number;
  #u_texture: WebGLUniformLocation;
  #a_uv: number;
  #a_mvp: number;
  #texture: WebGLTexture | null;
  #textureHeight: number;
  #textureWidth: number;
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

    this.#textureWidth = 0;
    this.#textureHeight = 0;

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

  use(scope: (s: SpriteEffect) => void) {
    this.#gl.useProgram(this.#program);
    scope(this);
    this.#end();
  }

  setTexture(param: {
    [TEXTURE]: WebGLTexture;
    width: number;
    height: number;
  }): SpriteEffect {
    if (param[TEXTURE] === this.#texture) {
      return this;
    } else if (this.#pending.length) {
      this.#end();
    }

    this.#texture = param[TEXTURE];
    this.#textureWidth = param.width;
    this.#textureHeight = param.height;
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

  draw(position: Rect, textureCoords: Rect): SpriteEffect {
    const mvp = mat3.create();
    mat3.translate(mvp, mvp, [position.left, position.top]);
    mat3.scale(mvp, mvp, [
      position.right - position.left,
      position.bottom - position.top,
    ]);
    mat3.multiply(mvp, this.#vp, mvp);

    const uv = mat3.create();
    mat3.translate(uv, uv, [
      textureCoords.left / this.#textureWidth,
      textureCoords.top / this.#textureHeight,
    ]);
    mat3.scale(uv, uv, [
      (textureCoords.right - textureCoords.left) / this.#textureWidth,
      (textureCoords.bottom - textureCoords.top) / this.#textureHeight,
    ]);

    this.#pending.push({ mvp, uv });
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
