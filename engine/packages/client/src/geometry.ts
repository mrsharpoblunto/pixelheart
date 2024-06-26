import { mat3 } from "gl-matrix";

import {
  AttributeType,
  Geometry,
  InstanceBuffer,
  ShaderProgram,
  ShaderSource,
} from "./gl-utils.js";

const VP = mat3.create();
mat3.translate(VP, VP, [-1.0, -1.0]);
mat3.scale(VP, VP, [2.0, 2.0]);

export const SpriteViewProjection = VP;

type QuadAttributes<TVertParams extends ShaderSource> = {
  position: AttributeType<TVertParams, "vec2">;
};

export class Quad implements Geometry {
  #vertexBuffer: WebGLBuffer;
  #gl: WebGL2RenderingContext;
  #vao: WebGLVertexArrayObject;
  #vaoInstances: Object | null;
  #vaoHash: string;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.#vaoHash = ""; this.#vaoInstances = null; this.#vao = this.#gl.createVertexArray()!;

    const vertices = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    this.#vertexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  #getAttributes<TVertParams extends ShaderSource>(
    program: ShaderProgram<TVertParams, any>,
    attributes: QuadAttributes<TVertParams>
  ): {
    position: number;
    hash: string;
  } {
    const ptrs = {
      position: program.inAttributes[attributes.position].location,
    };
    return { ...ptrs, hash: `${ptrs.position}` };
  }

  bind<TVertParams extends ShaderSource>(
    program: ShaderProgram<TVertParams, any>,
    attributes: QuadAttributes<TVertParams>,
    scope: (geometry: Geometry) => void
  ): void {
    const a = this.#getAttributes(program, attributes);

    this.#gl.bindVertexArray(this.#vao);
    if (this.#vaoHash !== a.hash || this.#vaoInstances !== null) {
      this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, this.#vertexBuffer);
      this.#gl.enableVertexAttribArray(a.position);
      this.#gl.vertexAttribPointer(a.position, 2, this.#gl.FLOAT, false, 0, 0);
      this.#vaoHash = a.hash;
      this.#vaoInstances = null;
    }

    scope(this);
    this.#gl.bindVertexArray(null);
  }

  draw() {
    this.#gl.drawArrays(this.#gl.TRIANGLE_STRIP, 0, 4);
  }

  bindInstances<TVertParams extends ShaderSource, TInstance>(
    program: ShaderProgram<TVertParams, any>,
    attributes: QuadAttributes<TVertParams>,
    instances: InstanceBuffer<TVertParams, TInstance>,
    scope: (geometry: Geometry) => void
  ): void {
    const a = this.#getAttributes(program, attributes);
    const instanceAttributesHash = instances.getAttributesHash(program);
    const hash = `${a.hash}:${instanceAttributesHash}`;

    this.#gl.bindVertexArray(this.#vao);
    if (this.#vaoHash !== hash || this.#vaoInstances !== instances) {
      this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, this.#vertexBuffer);
      this.#gl.enableVertexAttribArray(a.position);
      this.#gl.vertexAttribPointer(a.position, 2, this.#gl.FLOAT, false, 0, 0);
      this.#vaoHash = hash;
      this.#vaoInstances = instances.bind(program);
    }

    const instanceCount = instances.getInstanceCount();
    scope({
      draw: () => {
        this.#gl.drawArraysInstanced(
          this.#gl.TRIANGLE_STRIP,
          0,
          4,
          instanceCount
        );
      },
    });
    this.#gl.bindVertexArray(null);
  }
}
