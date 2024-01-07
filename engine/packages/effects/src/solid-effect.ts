import {
  GameContext,
  Quad,
  SpriteViewProjection,
  InstanceBuffer,
  ShaderProgram,
} from "@pixelheart/client";

import { vec2, mat3, vec4, ReadonlyVec4 } from "@pixelheart/client/gl-matrix";

import fragmentShader from "./shaders/solid.frag.js";
import vertexShader from "./shaders/solid.vert.js";

type SpriteInstance = { m: mat3; bounds: ReadonlyVec4, fillColor: ReadonlyVec4, borderColor: ReadonlyVec4 };

export class SolidEffect {
  #gl: WebGL2RenderingContext;
  #program: ShaderProgram<typeof vertexShader, typeof fragmentShader>;
  #instanceBuffer: InstanceBuffer<typeof vertexShader, SpriteInstance>;
  #quad: Quad;
  #pending: Array<SpriteInstance>;
  constructor(ctx: GameContext) {
    this.#gl = ctx.gl;
    this.#program = new ShaderProgram(ctx.gl, vertexShader, fragmentShader);
    this.#instanceBuffer = new InstanceBuffer(this.#gl, this.#program, {
      a_m: (instance) => instance.m,
      a_bounds: (instance) => instance.bounds,
      a_fillColor: (instance) => instance.fillColor,
      a_borderColor: (instance) => instance.borderColor,
    });
    this.#quad = new Quad(this.#gl);
    this.#pending = [];

  }

  use(scope: (s: SolidEffect) => void) {
    this.#program.use(() => {
      this.#program.setUniforms({
        u_border: vec2.fromValues(0, 0),
        u_vp: SpriteViewProjection,
      });
      scope(this);
      this.#end();
    });
  }

  setBorder(screen: { width: number, height: number }, width: number) {
    this.#program.setUniforms({
      u_border: vec2.fromValues(width / screen.width, width / screen.height),
    });
  }

  draw(bounds: ReadonlyVec4, fillColor: ReadonlyVec4, borderColor?: ReadonlyVec4): SolidEffect {
    const m = mat3.create();
    mat3.translate(m, m, [bounds[3], bounds[0]]);
    mat3.scale(m, m, [bounds[1] - bounds[3], bounds[2] - bounds[0]]);

    this.#pending.push({ m, bounds: vec4.clone(bounds), fillColor, borderColor: borderColor || fillColor });
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
