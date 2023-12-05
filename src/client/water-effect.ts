import { vec2 } from "gl-matrix";
import { GPUTexture, TEXTURE } from "./images";
import { ShaderProgram } from "./gl-utils";
import { Quad } from "./geometry";
import vertexShader from "./generated/shaders/quad.vert";
import fragmentShader from "./generated/shaders/water.frag";
import { ToTangentSpace, Tangent, Binormal, Normal } from "./sprite-common";

export class WaterEffect {
  #gl: WebGL2RenderingContext;
  #program: ShaderProgram<typeof vertexShader, typeof fragmentShader>;
  #quad: Quad;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.#program = new ShaderProgram(this.#gl, vertexShader, fragmentShader)!;
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
