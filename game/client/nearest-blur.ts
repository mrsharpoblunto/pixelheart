import { GameContext } from "@pixelheart/api";
import { Quad } from "@pixelheart/geometry";
import {
  FrameBuffer,
  ShaderProgram,
  createTexture,
} from "@pixelheart/gl-utils";
import { GPUTexture, TEXTURE } from "@pixelheart/images";

import fragmentShader from "./generated/shaders/nearest-blur.frag";
import vertexShader from "./generated/shaders/quad.vert";

export class NearestBlurEffect {
  #gl: WebGL2RenderingContext;
  #program: ShaderProgram<typeof vertexShader, typeof fragmentShader>;
  #quad: Quad;
  #blurBuffer: {
    frameBuffers: Array<FrameBuffer<typeof fragmentShader>>;
    textures: Array<GPUTexture>;
  } | null;

  constructor(ctx: GameContext) {
    this.#gl = ctx.gl;
    this.#program = new ShaderProgram(ctx, vertexShader, fragmentShader)!;
    this.#quad = new Quad(this.#gl);
    this.#blurBuffer = null;
  }

  draw(input: GPUTexture, blurStrength: number): NearestBlurEffect {
    if (
      !this.#blurBuffer ||
      this.#blurBuffer.textures[0].width !== input.width ||
      this.#blurBuffer.textures[0].height !== input.height
    ) {
      const textures: Array<GPUTexture> = [];
      for (let i = 0; i < 2; i++) {
        textures.push({
          [TEXTURE]: createTexture(
            this.#gl,
            this.#gl.RGBA,
            this.#gl.RGBA,
            this.#gl.UNSIGNED_BYTE,
            input.width,
            input.height
          ),
          width: input.width,
          height: input.height,
        });
      }
      this.#blurBuffer = {
        textures,
        frameBuffers: [
          new FrameBuffer(this.#gl, this.#program, {
            o_color: textures[0][TEXTURE],
          }),
          new FrameBuffer(this.#gl, this.#program, {
            o_color: textures[1][TEXTURE],
          }),
        ],
      };
    }

    const previousBlend = this.#gl.getParameter(this.#gl.BLEND);
    this.#gl.disable(this.#gl.BLEND);

    const b = this.#blurBuffer;
    this.#program.use((p) => {
      this.#gl.viewport(0, 0, input.width, input.height);
      // y axis blur, input as input, set output to textures 0
      p.setUniforms({
        u_blur: input[TEXTURE],
        u_blurSize: [input.width, input.height],
        u_blurDirection: [0, 1],
        u_blurStrength: blurStrength,
      });
      b.frameBuffers[0].bind(() => {
        this.#gl.clear(this.#gl.COLOR_BUFFER_BIT | this.#gl.DEPTH_BUFFER_BIT);
        this.#quad.bind(this.#program, { position: "a_position" }, (q) => {
          q.draw();
        });
      });
      // x axis blur, textures 0 as input, set output to textures 1
      p.setUniforms({
        u_blur: b.textures[0][TEXTURE],
        u_blurSize: [b.textures[0].width, b.textures[0].height],
        u_blurDirection: [1, 0],
      });
      b.frameBuffers[1].bind(() => {
        this.#gl.clear(this.#gl.COLOR_BUFFER_BIT | this.#gl.DEPTH_BUFFER_BIT);
        this.#quad.bind(this.#program, { position: "a_position" }, (q) => {
          q.draw();
        });
      });
      this.#gl.viewport(0, 0, input.width, input.height);
    });

    if (previousBlend) {
      this.#gl.enable(this.#gl.BLEND);
    }
    return this;
  }

  getBlurTexture(): GPUTexture {
    return this.#blurBuffer!.textures[1];
  }
}
