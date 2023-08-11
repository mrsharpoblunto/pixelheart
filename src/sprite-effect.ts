import { ReadonlyVec4, vec4, mat3 } from "gl-matrix";
import { TEXTURE, loadTextureFromUrl } from "./images";
import { GameContext } from "./game-runner";

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

export interface SpriteConfig {
  readonly width: number;
  readonly height: number;
  readonly frames: Array<{
    readonly top: number;
    readonly left: number;
    readonly bottom: number;
    readonly right: number;
  }>;
}

export interface Sprite {
  readonly width: number;
  readonly height: number;
  readonly frames: Array<ReadonlyVec4>;
  draw(effect: SpriteEffect, position: ReadonlyVec4, frame?: number): void;
}

export interface SpriteSheetConfig {
  url: string;
  sprites: Record<string, SpriteConfig>;
}

export interface SpriteSheet extends Record<string, Sprite> {}

export async function loadSpriteSheet(
  ctx: GameContext,
  sheet: SpriteSheetConfig
): Promise<SpriteSheet> {
  const texture = await loadTextureFromUrl(ctx, sheet.url);
  return {
    ...Object.keys(sheet.sprites).reduce(
      (p: Record<string, Sprite>, n: string) => {
        const sprite = sheet.sprites[n];
        const frames = sprite.frames.map((f) =>
          vec4.fromValues(f.top, f.right, f.bottom, f.left)
        );
        p[n] = {
          width: sprite.width,
          height: sprite.height,
          frames,
          draw: (
            effect: SpriteEffect,
            position: ReadonlyVec4,
            frame: number = 0
          ) => {
            effect.setTexture(texture);
            effect.draw(position, frames[Math.floor(frame) % frames.length]);
          },
        };
        return p;
      },
      {}
    ),
  };
}

export class SpriteAnimator {
  #sheet: SpriteSheet;
  #sprite: Sprite;
  #spriteName: string;
  frameRate: number;
  frame: number;

  constructor(spriteSheet: SpriteSheet, sprite: string, frameRate: number) {
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

  getSprite(): Sprite {
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

  draw(effect: SpriteEffect, position: ReadonlyVec4, offset: number = 0) {
    this.#sprite.draw(effect, position, this.frame + offset);
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

  draw(rect: ReadonlyVec4, textureCoords: ReadonlyVec4): SpriteEffect {
    const mvp = mat3.create();
    mat3.translate(mvp, mvp, [rect[3], rect[0]]);
    mat3.scale(mvp, mvp, [rect[1] - rect[3], rect[2] - rect[0]]);
    mat3.multiply(mvp, this.#vp, mvp);

    const uv = mat3.create();
    mat3.translate(uv, uv, [
      textureCoords[3] / this.#textureWidth,
      textureCoords[0] / this.#textureHeight,
    ]);
    mat3.scale(uv, uv, [
      (textureCoords[1] - textureCoords[3]) / this.#textureWidth,
      (textureCoords[2] - textureCoords[0]) / this.#textureHeight,
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
