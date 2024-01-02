import {
  FrameBuffer,
  GPUTexture,
  GameContext,
  Quad,
  ShaderProgram,
  TEXTURE,
  createTexture,
} from "@pixelheart/client";

import fragmentShader from "./shaders/gaussian-blur.frag.js";
import vertexShader from "./shaders/quad.vert.js";


export class GaussianBlurEffect {
  #gl: WebGL2RenderingContext;
  #program: ShaderProgram<typeof vertexShader, typeof fragmentShader>;
  #quad: Quad;
  #blurBuffer: {
    frameBuffers: Array<FrameBuffer<typeof fragmentShader>>;
    textures: Array<GPUTexture>;
  } | null;

  constructor(ctx: GameContext) {
    this.#gl = ctx.gl;
    this.#program = new ShaderProgram(ctx.gl, vertexShader, fragmentShader)!;
    this.#quad = new Quad(this.#gl);
    this.#blurBuffer = null;
  }

  draw(
    input: GPUTexture,
    blurStrength: number,
    scale: number = 1.0
  ): GaussianBlurEffect {
    if (
      !this.#blurBuffer ||
      this.#blurBuffer.textures[0].width !== input.width * scale ||
      this.#blurBuffer.textures[0].height !== input.height * scale
    ) {
      const textures: Array<GPUTexture> = [];
      for (let i = 0; i < 2; i++) {
        textures.push({
          [TEXTURE]: createTexture(
            this.#gl,
            this.#gl.RGBA,
            this.#gl.RGBA,
            this.#gl.UNSIGNED_BYTE,
            input.width * scale,
            input.height * scale
          ),
          width: input.width * scale,
          height: input.height * scale,
        });
      }
      const fb = new FrameBuffer(this.#gl, this.#program, {
        o_color: textures[1][TEXTURE],
      });
      this.#blurBuffer = {
        textures,
        frameBuffers: [
          fb,
          new FrameBuffer(this.#gl, this.#program, {
            o_color: textures[0][TEXTURE],
          }),
          fb,
        ],
      };
    }
    const b = this.#blurBuffer;
    this.#program.use((p) => {
      this.#gl.viewport(0, 0, input.width * scale, input.height * scale);
      if (scale !== 1.0) {
        // no blur, input as input, set output to textures 1
        p.setUniforms({
          u_blur: input[TEXTURE],
          u_blurSize: [input.width, input.height],
          u_blurDirection: [0, 0],
          u_blurStrength: blurStrength,
        });
        b.frameBuffers[0].bind(() => {
          this.#gl.clear(this.#gl.COLOR_BUFFER_BIT | this.#gl.DEPTH_BUFFER_BIT);
          this.#quad.bind(this.#program, { position: "a_position" }, (q) => {
            q.draw();
          });
        });
      }
      // y axis blur, textures 1 or input as input, set output to textures 0
      const scaledInput = scale !== 1.0 ? b.textures[1] : input;
      p.setUniforms({
        u_blur: scaledInput[TEXTURE],
        u_blurSize: [scaledInput.width, scaledInput.height],
        u_blurDirection: [0, 1],
        u_blurStrength: blurStrength,
      });
      b.frameBuffers[1].bind(() => {
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
      b.frameBuffers[2].bind(() => {
        this.#gl.clear(this.#gl.COLOR_BUFFER_BIT | this.#gl.DEPTH_BUFFER_BIT);
        this.#quad.bind(
          this.#program,
          { position: "a_position" },
          (q) => {
            q.draw();
          }
        );
      });
      this.#gl.viewport(0, 0, input.width, input.height);
    });
    return this;
  }

  getBlurTexture(): GPUTexture {
    return this.#blurBuffer!.textures[1];
  }
}
