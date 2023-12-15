import { vec2 } from "gl-matrix";

import { GameContext } from "@pixelheart/api";
import { Quad } from "@pixelheart/geometry";
import { ShaderProgram } from "@pixelheart/gl-utils";
import { GPUTexture, TEXTURE } from "@pixelheart/images";
import { Binormal, Normal, Tangent, ToTangentSpace } from "@pixelheart/sprite";

import vertexShader from "./generated/shaders/quad.vert";
import fragmentShader from "./generated/shaders/water.frag";

export class WaterEffect {
  #gl: WebGL2RenderingContext;
  #program: ShaderProgram<typeof vertexShader, typeof fragmentShader>;
  #quad: Quad;

  constructor(ctx: GameContext) {
    this.#gl = ctx.gl;
    this.#program = new ShaderProgram(ctx, vertexShader, fragmentShader)!;
    this.#quad = new Quad(this.#gl);
  }

  draw(
    time: number,
    offset: vec2,
    mask: GPUTexture,
    depth: GPUTexture
  ): WaterEffect {
    this.#program.use((p) => {
      p.setUniforms({
        u_normal: Normal,
        u_tangent: Tangent,
        u_binormal: Binormal,
        u_toTangentSpace: ToTangentSpace,
        u_time: time,
        u_offset: offset,
        u_mask: mask[TEXTURE],
        u_depth: depth[TEXTURE],
      });
      this.#quad.bind(this.#program, { position: "a_position" }, (q) => {
        q.draw();
      });
    });
    return this;
  }
}
