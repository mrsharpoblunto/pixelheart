import { mat3, ReadonlyVec4 } from "gl-matrix";
import {
  CompiledWebGLProgram,
  createProgram,
  bindInstanceBuffer,
} from "./gl-utils";

import vertexShader from "./shaders/solid.vert";
import fragmentShader from "./shaders/solid.frag";

export class SolidEffect {
  #gl: WebGL2RenderingContext;
  #program: CompiledWebGLProgram<typeof vertexShader, typeof fragmentShader>;
  #vertexBuffer: WebGLBuffer;
  #vp: mat3;
  #pending: Array<{ mvp: mat3; color: ReadonlyVec4 }>;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;

    this.#program = createProgram(
      this.#gl,
      vertexShader,
      fragmentShader,
    )!;

    const vertices = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    this.#vertexBuffer = this.#gl.createBuffer()!;
    this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, this.#vertexBuffer);
    this.#gl.bufferData(this.#gl.ARRAY_BUFFER, vertices, this.#gl.STATIC_DRAW);

    this.#vp = mat3.create();
    mat3.scale(this.#vp, this.#vp, [1.0, -1.0]);
    mat3.translate(this.#vp, this.#vp, [-1.0, -1.0]);
    mat3.scale(this.#vp, this.#vp, [2.0, 2.0]);

    this.#pending = [];
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
    bindInstanceBuffer(this.#gl, this.#program, this.#pending, [
      ["a_mvp", (instance) => instance.mvp],
      ["a_color", (instance) => instance.color],
    ]);

    this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, this.#vertexBuffer);
    this.#gl.enableVertexAttribArray(this.#program.attributes.a_position);
    this.#gl.vertexAttribPointer(
      this.#program.attributes.a_position,
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
  }
}
