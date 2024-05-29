import {
  Binormal,
  GPUTexture,
  GameContext,
  Normal,
  Quad,
  ShaderProgram,
  TEXTURE,
  coords,
  Tangent,
  ToTangentSpace,
} from "@pixelheart/client";
import { vec2 } from "@pixelheart/client/gl-matrix";
import vertexShader from "@pixelheart/effects/shaders/quad.vert";

import fragmentShader from "./shaders/water.frag.js";

export class WaterEffect {
  #gl: WebGL2RenderingContext;
  #program: ShaderProgram<typeof vertexShader, typeof fragmentShader>;
  #quad: Quad;

  constructor(ctx: GameContext) {
    this.#gl = ctx.gl;
    this.#program = new ShaderProgram(ctx.gl, vertexShader, fragmentShader)!;
    this.#quad = new Quad(this.#gl);
  }

  draw(
    time: number,
    offset: vec2,
    screen: { width: number, height: number },
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
        u_scale: vec2.fromValues(screen.width / coords.TILE_SIZE, screen.height / coords.TILE_SIZE),
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
