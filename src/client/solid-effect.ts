import { mat3, ReadonlyVec4 } from "gl-matrix";

import vertexShaderSource from "./shaders/solid.vert";
import fragmentShaderSource from "./shaders/solid.frag";

export class SolidEffect {
    #gl: WebGL2RenderingContext;
  #program: WebGLProgram;
  #a_position: number;
  #a_mvp: number;
  #a_color: number;
  #vertexBuffer: WebGLBuffer;
  #vp: mat3;
  #pending: Array<{ mvp: mat3; color: ReadonlyVec4 }>;

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
    this.#a_color = gl.getAttribLocation(this.#program, "a_color")!;
    this.#a_mvp = gl.getAttribLocation(this.#program, "a_mvp")!;

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
    this.#gl.useProgram(this.#program);
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
    const b = new Float32Array(this.#pending.length * (9 + 4));
    let offset = 0;
    for (let i = 0; i < this.#pending.length; ++i) {
      b.set(this.#pending[i].mvp, offset);
      offset += 9;
      b.set(this.#pending[i].color, offset);
      offset += 4;
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
      (9 + 4) * 4,
      0 * 3 * 4
    );
    this.#gl.vertexAttribDivisor(this.#a_mvp, 1);
    this.#gl.enableVertexAttribArray(this.#a_mvp + 1);
    this.#gl.vertexAttribPointer(
      this.#a_mvp + 1,
      3,
      this.#gl.FLOAT,
      false,
      (9 + 4) * 4,
      1 * 3 * 4
    );
    this.#gl.vertexAttribDivisor(this.#a_mvp + 1, 1);
    this.#gl.enableVertexAttribArray(this.#a_mvp + 2);
    this.#gl.vertexAttribPointer(
      this.#a_mvp + 2,
      3,
      this.#gl.FLOAT,
      false,
      (9 + 4) * 4,
      2 * 3 * 4
    );
    this.#gl.vertexAttribDivisor(this.#a_mvp + 2, 1);

    this.#gl.enableVertexAttribArray(this.#a_color);
    this.#gl.vertexAttribPointer(
      this.#a_color,
      4,
      this.#gl.FLOAT,
      false,
      (9 + 4) * 4,
      3 * 3 * 4
    );
    this.#gl.vertexAttribDivisor(this.#a_color, 1);

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
  }
}
