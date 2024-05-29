import {
  GameContext,
  Quad,
  SpriteViewProjection,
  FrameBuffer,
  GBuffer,
  InstanceBuffer,
  ShaderProgram,
  GPUTexture,
  TEXTURE,
  loadTextureFromUrl,
  SpriteAnimator,
  SpriteEffect,
  SpriteSheet,
  SpriteSheetConfig,
  ToTangentSpace,
} from "@pixelheart/client";
import { vec3, mat3, ReadonlyVec4 } from "@pixelheart/client/gl-matrix";

import lightingFragmentShader, {
  Constants as LightingConstants,
} from "./shaders/deferred-lighting.frag.js";
import lightingVertexShader from "./shaders/deferred-lighting.vert.js";
import fragmentShader from "./shaders/deferred-sprite.frag.js";
import vertexShader from "./shaders/deferred-sprite.vert.js";

export type DeferredSpriteTextures = {
  diffuseTexture: GPUTexture;
  normalTexture: GPUTexture;
  specularTexture: GPUTexture;
  emissiveTexture: GPUTexture;
};
export type DeferredSpriteSheet = SpriteSheet<DeferredSpriteTextures>;
export class DeferredSpriteAnimator extends SpriteAnimator<DeferredSpriteTextures> { }

const BLACK: vec3 = vec3.fromValues(0, 0, 0);
const FULL_UV = mat3.create();

export async function deferredTextureLoader(
  ctx: GameContext,
  sheet: SpriteSheetConfig
): Promise<DeferredSpriteTextures> {
  const [diffuseTexture, normalTexture, specularTexture, emissiveTexture] =
    await Promise.all([
      loadTextureFromUrl(ctx, sheet.urls.diffuse),
      loadTextureFromUrl(ctx, sheet.urls.normal),
      loadTextureFromUrl(ctx, sheet.urls.specular),
      loadTextureFromUrl(ctx, sheet.urls.emissive),
    ]);
  return {
    diffuseTexture,
    normalTexture,
    specularTexture,
    emissiveTexture,
  };
}

export type ScreenSpaceDirectionalLight = {
  diffuse: vec3;
  ambient: vec3;
  direction: vec3;
};

export type ScreenSpacePointLight = {
  diffuse: vec3;
  position: vec3;
  radius: number;
};

type SpriteInstance = {
  mvp: mat3;
  uv: mat3;
};

type LightInstance = {
  mvp: mat3;
  uv: mat3;
  ambient: vec3;
  diffuse: vec3;
  direction: vec3;
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
  #lightBuffer: InstanceBuffer<typeof lightingVertexShader, LightInstance>;
  #pendingDirectionalLights: Array<LightInstance>;
  #pendingPointLights: Array<LightInstance>;

  #texture: DeferredSpriteTextures | null;
  #quad: Quad;

  #gBuffer: GBuffer<"normal" | "albedo" | "specular" | "lighting" | "mask">;
  #frameBuffers: {
    maskFrameBuffer: FrameBuffer<typeof fragmentShader>;
    noMaskFrameBuffer: FrameBuffer<typeof fragmentShader>;
    lightingFrameBuffer: FrameBuffer<typeof lightingFragmentShader>;
  } | null;

  constructor(ctx: GameContext) {
    this.#gl = ctx.gl;
    this.#gBufferProgram = new ShaderProgram(ctx.gl, vertexShader, fragmentShader);
    this.#instanceBuffer = new InstanceBuffer(this.#gl, this.#gBufferProgram, {
      a_mvp: (instance) => instance.mvp,
      a_uv: (instance) => instance.uv,
    });
    this.#pending = [];
    this.#lightingProgram = new ShaderProgram(
      ctx.gl,
      lightingVertexShader,
      lightingFragmentShader
    );
    this.#lightBuffer = new InstanceBuffer(this.#gl, this.#lightingProgram, {
      a_mvp: (instance) => instance.mvp,
      a_uv: (instance) => instance.uv,
      a_ambient: (instance) => instance.ambient,
      a_diffuse: (instance) => instance.diffuse,
      a_direction: (instance) => instance.direction,
      a_radius: (instance) => instance.radius,
    });
    this.#pendingDirectionalLights = [];
    this.#pendingPointLights = [];

    this.#quad = new Quad(this.#gl);
    this.#texture = null;
    this.#frameBuffers = null;
    this.#gBuffer = new GBuffer(this.#gl, {
      normal: {
        internalFormat: this.#gl.RGBA,
        format: this.#gl.RGBA,
        type: this.#gl.UNSIGNED_BYTE,
      },
      albedo: {
        internalFormat: this.#gl.RGBA,
        format: this.#gl.RGBA,
        type: this.#gl.UNSIGNED_BYTE,
      },
      specular: {
        internalFormat: this.#gl.RGBA,
        format: this.#gl.RGBA,
        type: this.#gl.UNSIGNED_BYTE,
      },
      lighting: {
        internalFormat: this.#gl.RGBA,
        format: this.#gl.RGBA,
        type: this.#gl.UNSIGNED_BYTE,
      },
      mask: {
        internalFormat: this.#gl.RGBA,
        format: this.#gl.RGBA,
        type: this.#gl.UNSIGNED_BYTE,
      },
    });
  }

  use(
    opts: {
      width: number;
      height: number;
    },
    fillScope: (s: DeferredSpriteEffect, pass?: number) => void,
    maskScope?: (mask: GPUTexture) => void
  ) {
    const g = this.#gBuffer.use(opts, (gBuffer) => {
      this.#frameBuffers = {
        maskFrameBuffer: new FrameBuffer(this.#gl, this.#gBufferProgram, {
          o_normal: gBuffer.normal,
          o_albedo: gBuffer.albedo,
          o_specular: gBuffer.specular,
          o_lighting: gBuffer.lighting,
          o_mask: maskScope ? gBuffer.mask : null,
        }),
        noMaskFrameBuffer: new FrameBuffer(this.#gl, this.#gBufferProgram, {
          o_normal: gBuffer.normal,
          o_albedo: gBuffer.albedo,
          o_specular: gBuffer.specular,
          o_lighting: gBuffer.lighting,
          o_mask: null,
        }),
        lightingFrameBuffer: new FrameBuffer(this.#gl, this.#lightingProgram, {
          o_lighting: gBuffer.lighting,
        }),
      }
    });

    const f = this.#frameBuffers!;

    const vp = this.#gl.getParameter(this.#gl.VIEWPORT);
    this.#gl.viewport(0, 0, this.#gBuffer.width, this.#gBuffer.height);

    // render the base sprite layer
    f.maskFrameBuffer.bind(() => {
      this.#gl.clear(this.#gl.COLOR_BUFFER_BIT | this.#gl.DEPTH_BUFFER_BIT);
      this.#gBufferProgram.use(() => {
        // only the base layer textures contribute to the mask
        fillScope(this, 0);
        this.#end();
      });
    });

    if (maskScope) {
      // finally, render the mask overlay & top layer of sprites
      f.noMaskFrameBuffer.bind(() => {
        maskScope(g.mask);
        this.#gBufferProgram.use(() => {
          fillScope(this, 1);
          this.#end();
        });
      });
    }

    f.lightingFrameBuffer.bind(() => {
      const previousBlend = this.#gl.getParameter(this.#gl.BLEND);
      const previousBlendSrcFunc = this.#gl.getParameter(
        this.#gl.BLEND_SRC_ALPHA
      );
      const previousBlendDestFunc = this.#gl.getParameter(
        this.#gl.BLEND_DST_ALPHA
      );
      this.#gl.enable(this.#gl.BLEND);
      this.#gl.blendFunc(this.#gl.ONE, this.#gl.ONE);

      this.#lightingProgram.use((p) => {
        p.setUniforms({
          u_albedoTexture: g.albedo,
          u_normalTexture: g.normal,
          u_specularTexture: g.specular,
          u_toTangentSpace: ToTangentSpace,
          u_viewDirection: vec3.fromValues(0, 0, -1),
        });

        if (this.#pendingDirectionalLights.length) {
          p.setUniforms({
            u_lightingMode: LightingConstants.LIGHTING_MODE_DIRECTIONAL,
          });
          this.#quad.bindInstances(
            p,
            { position: "a_position" },
            this.#lightBuffer.load(this.#pendingDirectionalLights),
            (q) => q.draw()
          );
          this.#pendingDirectionalLights.length = 0;
        }
        if (this.#pendingPointLights.length) {
          p.setUniforms({
            u_lightingMode: LightingConstants.LIGHTING_MODE_POINT,
          });
          this.#quad.bindInstances(
            p,
            { position: "a_position" },
            this.#lightBuffer.load(this.#pendingPointLights),
            (q) => q.draw()
          );
          this.#pendingPointLights.length = 0;
        }
      });

      if (!previousBlend) {
        this.#gl.disable(this.#gl.BLEND);
      }
      this.#gl.blendFunc(previousBlendSrcFunc, previousBlendDestFunc);
    });

    this.#gl.viewport(vp[0], vp[1], vp[2], vp[3]);
  }

  addDirectionalLight(
    light: ScreenSpaceDirectionalLight
  ): DeferredSpriteEffect {
    this.#pendingDirectionalLights.push({
      mvp: SpriteViewProjection,
      uv: FULL_UV,
      ambient: light.ambient,
      diffuse: light.diffuse,
      direction: light.direction,
      radius: 0,
    });
    return this;
  }

  addPointLight(light: ScreenSpacePointLight): DeferredSpriteEffect {
    if (light.position[2] >= light.radius) {
      // doesn't intersect the ground plane, so disregard the light
      return this;
    }

    const intersectingRadius = Math.sqrt(
      light.radius * light.radius - light.position[2] * light.position[2]
    );

    const mvp = mat3.create();
    mat3.translate(mvp, mvp, [
      light.position[0] - intersectingRadius,
      light.position[1] - intersectingRadius,
    ]);
    mat3.scale(mvp, mvp, [intersectingRadius * 2, intersectingRadius * 2]);
    mat3.mul(mvp, SpriteViewProjection, mvp);
    const uv = mat3.create();
    mat3.translate(uv, uv, [
      light.position[0] - intersectingRadius,
      light.position[1] - intersectingRadius,
    ]);
    mat3.scale(uv, uv, [intersectingRadius * 2, intersectingRadius * 2]);

    this.#pendingPointLights.push({
      mvp,
      uv,
      ambient: BLACK,
      diffuse: light.diffuse,
      direction: vec3.fromValues(
        light.position[0],
        light.position[1],
        light.position[2]
      ),
      radius: light.radius,
    });
    return this;
  }

  getLightingTexture(): GPUTexture | undefined {
    return this.#gBuffer.textures?.lighting;
  }

  setTextures(param: DeferredSpriteTextures): DeferredSpriteEffect {
    if (param === this.#texture) {
      return this;
    } else if (this.#pending.length) {
      this.#end();
    }
    this.#texture = param;

    this.#gBufferProgram.setUniforms({
      u_diffuseTexture: param.diffuseTexture[TEXTURE],
      u_normalTexture: param.normalTexture[TEXTURE],
      u_specularTexture: param.specularTexture[TEXTURE],
      u_emissiveTexture: param.emissiveTexture[TEXTURE],
    });

    return this;
  }

  draw(
    screenSpaceRect: ReadonlyVec4,
    textureCoords: ReadonlyVec4
  ): DeferredSpriteEffect {
    if (this.#texture) {
      const mvp = mat3.create();
      mat3.translate(mvp, mvp, [screenSpaceRect[3], screenSpaceRect[0]]);
      mat3.scale(mvp, mvp, [
        screenSpaceRect[1] - screenSpaceRect[3],
        screenSpaceRect[2] - screenSpaceRect[0],
      ]);
      mat3.multiply(mvp, SpriteViewProjection, mvp);

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

    this.#pending.length = 0;
    this.#texture = null;
  }
}
