import { mat3, ReadonlyVec4 } from "gl-matrix";
import { ShaderProgram, createProgram, InstanceBuffer } from "./gl-utils";
import { Quad } from "./geometry";

import vertexShader from "./shaders/solid.vert";
import fragmentShader from "./shaders/solid.frag";

type SpriteInstance = { mvp: mat3; color: ReadonlyVec4 };

export class SolidEffect {
  #gl: WebGL2RenderingContext;
  #program: ShaderProgram<typeof vertexShader, typeof fragmentShader>;
  #instanceBuffer: InstanceBuffer<typeof vertexShader, SpriteInstance>;
  #quad: Quad;
  #vp: mat3;
  #pending: Array<SpriteInstance>;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.#program = createProgram(this.#gl, vertexShader, fragmentShader)!;
    this.#instanceBuffer = new InstanceBuffer(this.#gl, this.#program, {
      a_mvp: (instance) => instance.mvp,
      a_color: (instance) => instance.color,
    });
    this.#quad = new Quad(this.#gl);
    this.#pending = [];

    this.#vp = mat3.create();
    mat3.scale(this.#vp, this.#vp, [1.0, -1.0]);
    mat3.translate(this.#vp, this.#vp, [-1.0, -1.0]);
    mat3.scale(this.#vp, this.#vp, [2.0, 2.0]);
  }

  use(scope: (s: SolidEffect) => void) {
    this.#gl.useProgram(this.#program.program);
    scope(this);
    this.#end();
  }

  draw(bounds: ReadonlyVec4, color: ReadonlyVec4): SolidEffect {
    const mvp = mat3.create();
    mat3.translate(mvp, mvp, [bounds[3], bounds[0]]);
    mat3.scale(mvp, mvp, [bounds[1] - bounds[3], bounds[2] - bounds[0]]);
    mat3.multiply(mvp, this.#vp, mvp);

    this.#pending.push({ mvp, color });
    return this;
  }

  #end() {
    this.#quad.bindInstances(
      this.#program,
      { position: "a_position" },
      this.#instanceBuffer.load(this.#pending),
      (q) => q.draw()
    );
    this.#pending = [];
  }
}
