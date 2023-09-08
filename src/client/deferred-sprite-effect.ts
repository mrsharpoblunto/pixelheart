import { ReadonlyVec4, mat3, vec3, vec4 } from "gl-matrix";
import { TEXTURE, GPUTexture, loadTextureFromUrl } from "./images";
import { GameContext } from "./game-runner";
import {
  SpriteEffect,
  SpriteSheet,
  SpriteAnimator,
  SpriteSheetConfig,
} from "./sprite-common";
import { Quad } from "./geometry";
import {
  ShaderProgram,
  createProgram,
  createTexture,
  InstanceBuffer,
} from "./gl-utils";
import vertexShader from "./shaders/deferred-sprite.vert";
import fragmentShader from "./shaders/deferred-sprite.frag";
//import lightVertexShader from "./shaders/deferred-sprite-lighting.vert";
//import lightFragmentShader from "./shaders/deferred-sprite-lighting.frag";

export type DeferredSpriteTextures = {
  diffuseTexture: GPUTexture;
  normalSpecularTexture: GPUTexture;
  emissiveTexture: GPUTexture;
};
export type DeferredSpriteSheet = SpriteSheet<DeferredSpriteTextures>;
export class DeferredSpriteAnimator extends SpriteAnimator<DeferredSpriteTextures> {}

export async function deferredTextureLoader(
  ctx: GameContext,
  sheet: SpriteSheetConfig
): Promise<DeferredSpriteTextures> {
  const [diffuseTexture, normalSpecularTexture, emissiveTexture] =
    await Promise.all([
      loadTextureFromUrl(ctx, sheet.urls.diffuse),
      loadTextureFromUrl(ctx, sheet.urls.normalSpecular),
      loadTextureFromUrl(ctx, sheet.urls.emissive),
    ]);
  return {
    diffuseTexture,
    normalSpecularTexture,
    emissiveTexture,
  };
}

export type DeferredLight =
  | {
      type: "direction";
      color: vec3;
      ambient: vec4;
      direction: vec3;
    }
  | {
      type: "point";
      color: vec3;
      position?: vec3;
      radius?: number;
    };

type SpriteInstance = {
  mvp: mat3;
  uv: mat3;
};

type LightInstance = {
  ambient: vec3;
  lightColor: vec3;
  pointOrDirection: vec3;
  radius: number;
};

export class DeferredSpriteEffect
  implements SpriteEffect<DeferredSpriteTextures>
{
  #gl: WebGL2RenderingContext;
  #gBufferProgram: ShaderProgram<typeof vertexShader, typeof fragmentShader>;
  #instanceBuffer: InstanceBuffer<typeof vertexShader, SpriteInstance>;
  #pending: Array<SpriteInstance>;

  //#lightProgram: ShaderProgram<typeof lightVertexShader, typeof lightFragmentShader>;
  #texture: DeferredSpriteTextures | null;
  #vp: mat3;
  #pendingLights: Array<DeferredLight>;
  #quad: Quad;

  #gBuffer: {
    frameBuffer: WebGLFramebuffer;
    lightingFrameBuffer: WebGLFramebuffer;
    normal: WebGLTexture;
    albedo: WebGLTexture;
    specular: WebGLTexture;
    lighting: GPUTexture;
  } | null;
  #gBufferWidth: number;
  #gBufferHeight: number;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.#gBufferProgram = createProgram(gl, vertexShader, fragmentShader)!;
    this.#instanceBuffer = new InstanceBuffer(gl, this.#gBufferProgram, [
      ["a_mvp", (instance) => instance.mvp],
      ["a_uv", (instance) => instance.uv],
    ]);
    this.#quad = new Quad(gl);
    this.#pending = [];
    this.#pendingLights = [];
    this.#texture = null;
    this.#gBuffer = null;
    this.#gBufferWidth = this.#gBufferHeight = 0;

    this.#vp = mat3.create();
    mat3.scale(this.#vp, this.#vp, [1.0, -1.0]);
    mat3.translate(this.#vp, this.#vp, [-1.0, -1.0]);
    mat3.scale(this.#vp, this.#vp, [2.0, 2.0]);
  }

  use(
    opts: {
      width: number;
      height: number;
    },
    scope: (s: DeferredSpriteEffect) => void
  ) {
    if (
      !this.#gBuffer ||
      opts.width !== this.#gBufferWidth ||
      opts.height !== this.#gBufferHeight
    ) {
      this.#gBufferHeight = opts.height;
      this.#gBufferWidth = opts.width;
      this.#gBuffer = {
        frameBuffer: this.#gl.createFramebuffer()!,
        lightingFrameBuffer: this.#gl.createFramebuffer()!,
        normal: createTexture(
          this.#gl,
          this.#gl.RGBA,
          this.#gl.RGBA,
          this.#gl.UNSIGNED_BYTE,
          opts.width,
          opts.height
        ),
        albedo: createTexture(
          this.#gl,
          this.#gl.RGBA,
          this.#gl.RGBA,
          this.#gl.UNSIGNED_BYTE,
          opts.width,
          opts.height
        ),
        specular: createTexture(
          this.#gl,
          this.#gl.RGBA,
          this.#gl.RGBA,
          this.#gl.UNSIGNED_BYTE,
          opts.width,
          opts.height
        ),
        lighting: {
          [TEXTURE]: createTexture(
            this.#gl,
            this.#gl.RGBA,
            this.#gl.RGBA,
            this.#gl.UNSIGNED_BYTE,
            opts.width,
            opts.height
          ),
          width: opts.width,
          height: opts.height,
        },
      };

      // framebuffer used for storing the gbuffer data
      this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, this.#gBuffer.frameBuffer);
      this.#gl.framebufferTexture2D(
        this.#gl.FRAMEBUFFER,
        this.#gl.COLOR_ATTACHMENT0,
        this.#gl.TEXTURE_2D,
        this.#gBuffer.normal,
        0
      );
      this.#gl.framebufferTexture2D(
        this.#gl.FRAMEBUFFER,
        this.#gl.COLOR_ATTACHMENT1,
        this.#gl.TEXTURE_2D,
        this.#gBuffer.albedo,
        0
      );
      this.#gl.framebufferTexture2D(
        this.#gl.FRAMEBUFFER,
        this.#gl.COLOR_ATTACHMENT2,
        this.#gl.TEXTURE_2D,
        this.#gBuffer.specular,
        0
      );
      this.#gl.framebufferTexture2D(
        this.#gl.FRAMEBUFFER,
        this.#gl.COLOR_ATTACHMENT3,
        this.#gl.TEXTURE_2D,
        this.#gBuffer.lighting[TEXTURE],
        0
      );
      this.#gl.drawBuffers([
        this.#gl.COLOR_ATTACHMENT0,
        this.#gl.COLOR_ATTACHMENT1,
        this.#gl.COLOR_ATTACHMENT2,
        this.#gl.COLOR_ATTACHMENT3,
      ]);
      this.#gl.checkFramebufferStatus(this.#gl.FRAMEBUFFER);

      // framebuffer used for the lighting accumulation passes
      this.#gl.bindFramebuffer(
        this.#gl.FRAMEBUFFER,
        this.#gBuffer.lightingFrameBuffer
      );
      this.#gl.framebufferTexture2D(
        this.#gl.FRAMEBUFFER,
        this.#gl.COLOR_ATTACHMENT0,
        this.#gl.TEXTURE_2D,
        this.#gBuffer.lighting[TEXTURE],
        0
      );
      this.#gl.drawBuffers([this.#gl.COLOR_ATTACHMENT0]);
      this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, null);
    }

    this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, this.#gBuffer.frameBuffer);
    this.#gl.viewport(0, 0, this.#gBufferWidth, this.#gBufferHeight);
    this.#gl.clear(this.#gl.COLOR_BUFFER_BIT | this.#gl.DEPTH_BUFFER_BIT);

    this.#gl.useProgram(this.#gBufferProgram.program);
    scope(this);
    this.#end();

    /**
    this.#gl.bindFramebuffer(
      this.#gl.FRAMEBUFFER,
      this.#gBuffer.lightingFrameBuffer
    );
    this.#gl.useProgram(this.#lightProgram);
    // TODO attach the gbuffer to the lighting program
    for (let light of this.#pendingLights) {
      // TODO bind the lighting framebuffer & render queued lights...
    }
    */

    this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, null);
    this.#pendingLights = [];
  }

  addLight(light: DeferredLight): DeferredSpriteEffect {
    this.#pendingLights.push(light);
    return this;
  }

  getLightingTexture(): GPUTexture | undefined {
    return {
      [TEXTURE]: this.#gBuffer!.albedo,
      width: this.#gBufferWidth,
      height: this.#gBufferHeight,
    };
    // return this.#gBuffer?.lighting;
  }

  setTextures(param: DeferredSpriteTextures): DeferredSpriteEffect {
    if (param === this.#texture) {
      return this;
    } else if (this.#pending.length) {
      this.#end();
    }
    this.#texture = param;

    this.#gl.activeTexture(this.#gl.TEXTURE0);
    this.#gl.bindTexture(this.#gl.TEXTURE_2D, param.diffuseTexture[TEXTURE]);
    this.#gl.uniform1i(this.#gBufferProgram.uniforms.u_diffuseTexture, 0);

    this.#gl.activeTexture(this.#gl.TEXTURE1);
    this.#gl.bindTexture(
      this.#gl.TEXTURE_2D,
      param.normalSpecularTexture[TEXTURE]
    );
    this.#gl.uniform1i(
      this.#gBufferProgram.uniforms.u_normalSpecularTexture,
      1
    );

    this.#gl.activeTexture(this.#gl.TEXTURE2);
    this.#gl.bindTexture(this.#gl.TEXTURE_2D, param.emissiveTexture[TEXTURE]);
    this.#gl.uniform1i(this.#gBufferProgram.uniforms.u_emissiveTexture, 2);

    return this;
  }

  draw(rect: ReadonlyVec4, textureCoords: ReadonlyVec4): DeferredSpriteEffect {
    if (this.#texture) {
      const mvp = mat3.create();
      mat3.translate(mvp, mvp, [rect[3], rect[0]]);
      mat3.scale(mvp, mvp, [rect[1] - rect[3], rect[2] - rect[0]]);
      mat3.multiply(mvp, this.#vp, mvp);

      const uv = mat3.create();
      mat3.translate(uv, uv, [
        textureCoords[3] / this.#texture.diffuseTexture.width,
        textureCoords[0] / this.#texture.diffuseTexture.height,
      ]);
      mat3.scale(uv, uv, [
        (textureCoords[1] - textureCoords[3]) /
          this.#texture.diffuseTexture.width,
        (textureCoords[2] - textureCoords[0]) /
          this.#texture.diffuseTexture.height,
      ]);

      this.#pending.push({ mvp, uv });
    }
    return this;
  }

  #end() {
    if (!this.#pending.length) {
      return;
    }

    this.#instanceBuffer
      .load(this.#pending)
      .bind(this.#gBufferProgram, (instanceCount) => {
        this.#quad.bind(this.#gBufferProgram, "a_position", (q) => {
          q.drawInstanced(instanceCount);
        });
      });

    this.#pending = [];
    this.#texture = null;
  }
}
