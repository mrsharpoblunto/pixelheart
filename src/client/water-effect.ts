import { GPUTexture, TEXTURE } from "./images";
import { ShaderProgram } from "./gl-utils";
import { Quad } from "./geometry";
import vertexShader from "./shaders/quad.vert";
import fragmentShader from "./shaders/water.frag";

export class WaterEffect {
  #gl: WebGL2RenderingContext;
  #program: ShaderProgram<typeof vertexShader, typeof fragmentShader>;
  #quad: Quad;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.#program = new ShaderProgram(this.#gl, vertexShader, fragmentShader)!;
    this.#quad = new Quad(this.#gl);
  }

  draw(mask: GPUTexture, depth: GPUTexture): WaterEffect {
    this.#program.use((p) => {
      p.setUniforms({
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
