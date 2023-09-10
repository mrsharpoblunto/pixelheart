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
  createTexture,
  InstanceBuffer,
  FrameBuffer,
} from "./gl-utils";
import vertexShader from "./shaders/deferred-sprite.vert";
import fragmentShader from "./shaders/deferred-sprite.frag";
import lightingVertexShader from "./shaders/deferred-lighting.vert";
import lightingFragmentShader from "./shaders/deferred-lighting.frag";

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

  #lightingProgram: ShaderProgram<
    typeof lightingVertexShader,
    typeof lightingFragmentShader
  >;
  #texture: DeferredSpriteTextures | null;
  #vp: mat3;
  #pendingLights: Array<DeferredLight>;
  #quad: Quad;

  #gBuffer: {
    normal: WebGLTexture;
    albedo: WebGLTexture;
    specular: WebGLTexture;
    lighting: GPUTexture;
    frameBuffer: FrameBuffer;
    lightingFrameBuffer: FrameBuffer;
  } | null;
  #gBufferWidth: number;
  #gBufferHeight: number;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.#gBufferProgram = new ShaderProgram(gl, vertexShader, fragmentShader);
    this.#lightingProgram = new ShaderProgram(
      gl,
      lightingVertexShader,
      lightingFragmentShader
    );
    this.#instanceBuffer = new InstanceBuffer(gl, this.#gBufferProgram, {
      a_mvp: (instance) => instance.mvp,
      a_uv: (instance) => instance.uv,
    });
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
      const gBuffer = {
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

      this.#gBuffer = {
        ...gBuffer,
        frameBuffer: new FrameBuffer(this.#gl, [
          gBuffer.normal,
          gBuffer.albedo,
          gBuffer.specular,
          gBuffer.lighting[TEXTURE],
        ]),
        lightingFrameBuffer: new FrameBuffer(this.#gl, [
          gBuffer.lighting[TEXTURE],
        ]),
      };
    }

    this.#gBuffer.frameBuffer.bind(() => {
      this.#gl.viewport(0, 0, this.#gBufferWidth, this.#gBufferHeight);
      this.#gl.clear(this.#gl.COLOR_BUFFER_BIT | this.#gl.DEPTH_BUFFER_BIT);
      this.#gBufferProgram.use(() => {
        scope(this);
        this.#end();
      });
    });

    this.#gBuffer.lightingFrameBuffer.bind(() => {
      const previousBlend = this.#gl.getParameter(this.#gl.BLEND);
      const previousBlendSrcFunc = this.#gl.getParameter(this.#gl.BLEND_SRC_ALPHA);
      const previousBlendDestFunc = this.#gl.getParameter(this.#gl.BLEND_DST_ALPHA);
      this.#gl.enable(this.#gl.BLEND);
      this.#gl.blendFunc(this.#gl.ONE, this.#gl.ONE);

      this.#lightingProgram.use(() => {
        this.#gl.activeTexture(this.#gl.TEXTURE0);
        this.#gl.bindTexture(this.#gl.TEXTURE_2D, this.#gBuffer!.albedo);
        this.#gl.uniform1i(this.#lightingProgram.uniforms.u_albedoTexture, 0);

        this.#gl.activeTexture(this.#gl.TEXTURE1);
        this.#gl.bindTexture(this.#gl.TEXTURE_2D, this.#gBuffer!.normal);
        this.#gl.uniform1i(this.#lightingProgram.uniforms.u_normalTexture, 1);

        this.#gl.activeTexture(this.#gl.TEXTURE2);
        this.#gl.bindTexture(this.#gl.TEXTURE_2D, this.#gBuffer!.specular);
        this.#gl.uniform1i(this.#lightingProgram.uniforms.u_specularTexture, 2);

        //for (let light of this.#pendingLights) {
        // TODO bind the lighting framebuffer & render queued lights...
        //}
      });

      if (!previousBlend) {
        this.#gl.disable(this.#gl.BLEND);
      }
      this.#gl.blendFunc(previousBlendSrcFunc, previousBlendDestFunc);
    });

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

    this.#quad.bindInstances(
      this.#gBufferProgram,
      { position: "a_position" },
      this.#instanceBuffer.load(this.#pending),
      (q) => q.draw()
    );

    this.#pending = [];
    this.#texture = null;
  }
}
