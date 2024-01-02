import { 
  GameContext,
  Quad, 
  SpriteViewProjection,
  InstanceBuffer,
  ShaderProgram,
} from "@pixelheart/client";

import { mat3, ReadonlyVec4 } from "@pixelheart/client/gl-matrix";

import fragmentShader from "./shaders/solid.frag.js";
import vertexShader from "./shaders/solid.vert.js";

type SpriteInstance = { mvp: mat3; color: ReadonlyVec4 };

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
      a_mvp: (instance) => instance.mvp,
      a_color: (instance) => instance.color,
    });
    this.#quad = new Quad(this.#gl);
    this.#pending = [];
  }

  use(scope: (s: SolidEffect) => void) {
    this.#program.use(() => {
      scope(this);
      this.#end();
    });
  }

  draw(bounds: ReadonlyVec4, color: ReadonlyVec4): SolidEffect {
    const mvp = mat3.create();
    mat3.translate(mvp, mvp, [bounds[3], bounds[0]]);
    mat3.scale(mvp, mvp, [bounds[1] - bounds[3], bounds[2] - bounds[0]]);
    mat3.multiply(mvp, SpriteViewProjection, mvp);

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
