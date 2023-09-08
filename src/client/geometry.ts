import {
  Geometry,
  AttributeType,
  ShaderProgram,
  ShaderParameters,
} from "./gl-utils";

export class Quad {
  #vertexBuffer: WebGLBuffer;
  #gl: WebGL2RenderingContext;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    const vertices = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    this.#vertexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  bind<TVertParams extends ShaderParameters>(
    program: ShaderProgram<TVertParams, any>,
    positionAttribute: AttributeType<TVertParams["attributes"], "vec2">,
    scope: (geometry: Geometry) => void
  ): void {
    this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, this.#vertexBuffer);
    this.#gl.enableVertexAttribArray(program.attributes[positionAttribute]);
    this.#gl.vertexAttribPointer(
      program.attributes[positionAttribute],
      2,
      this.#gl.FLOAT,
      false,
      0,
      0
    );

    scope({
      draw: () => {
        this.#gl.drawArrays(this.#gl.TRIANGLE_STRIP, 0, 4);
      },
      drawInstanced: (instanceCount: number) => {
        this.#gl.drawArraysInstanced(this.#gl.TRIANGLE_STRIP, 0, 4, instanceCount);
      },
    });
  }
}
