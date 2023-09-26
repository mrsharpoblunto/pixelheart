import { ReadonlyVec4, mat3, vec2, vec3 } from "gl-matrix";
import { TEXTURE, GPUTexture, loadTextureFromUrl } from "./images";
import { GameContext } from "./game-runner";
import {
  SpriteEffect,
  SpriteSheet,
  SpriteAnimator,
  SpriteSheetConfig,
} from "./sprite-common";
import { SpriteViewProjection, Quad } from "./geometry";
import {
  ShaderProgram,
  createTexture,
  InstanceBuffer,
  FrameBuffer,
} from "./gl-utils";
import { ToTangentSpace } from "./sprite-common";
import vertexShader from "./shaders/deferred-sprite.vert";
import fragmentShader from "./shaders/deferred-sprite.frag";
import lightingVertexShader from "./shaders/deferred-lighting.vert";
import lightingFragmentShader, {
  Constants as LightingConstants,
} from "./shaders/deferred-lighting.frag";

export type DeferredSpriteTextures = {
  diffuseTexture: GPUTexture;
  normalTexture: GPUTexture;
  specularTexture: GPUTexture;
  emissiveTexture: GPUTexture;
};
export type DeferredSpriteSheet = SpriteSheet<DeferredSpriteTextures>;
export class DeferredSpriteAnimator extends SpriteAnimator<DeferredSpriteTextures> {}

const BLACK: vec3 = vec3.fromValues(0, 0, 0);
const FULL_MVP = mat3.create();
mat3.scale(FULL_MVP, FULL_MVP, [1, -1]);
mat3.mul(FULL_MVP, FULL_MVP, SpriteViewProjection);

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
  position: vec2;
  height: number;
  radius: number;
};

type SpriteInstance = {
  mvp: mat3;
  uv: mat3;
};

type LightInstance = {
  mvp: mat3;
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

  #gBuffer: {
    normal: WebGLTexture;
    albedo: WebGLTexture;
    specular: WebGLTexture;
    lighting: GPUTexture;
    frameBuffer: FrameBuffer<typeof fragmentShader>;
    lightingFrameBuffer: FrameBuffer<typeof lightingFragmentShader>;
  } | null;
  #gBufferWidth: number;
  #gBufferHeight: number;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.#gBufferProgram = new ShaderProgram(gl, vertexShader, fragmentShader);
    this.#instanceBuffer = new InstanceBuffer(gl, this.#gBufferProgram, {
      a_mvp: (instance) => instance.mvp,
      a_uv: (instance) => instance.uv,
    });
    this.#pending = [];
    this.#lightingProgram = new ShaderProgram(
      gl,
      lightingVertexShader,
      lightingFragmentShader
    );
    this.#lightBuffer = new InstanceBuffer(gl, this.#lightingProgram, {
      a_mvp: (instance) => instance.mvp,
      a_ambient: (instance) => instance.ambient,
      a_diffuse: (instance) => instance.diffuse,
      a_direction: (instance) => instance.direction,
      a_radius: (instance) => instance.radius,
    });
    this.#pendingDirectionalLights = [];
    this.#pendingPointLights = [];

    this.#quad = new Quad(gl);
    this.#texture = null;
    this.#gBuffer = null;
    this.#gBufferWidth = this.#gBufferHeight = 0;
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
        frameBuffer: new FrameBuffer(this.#gl, this.#gBufferProgram, {
          o_normal: gBuffer.normal,
          o_albedo: gBuffer.albedo,
          o_specular: gBuffer.specular,
          o_lighting: gBuffer.lighting[TEXTURE],
        }),
        lightingFrameBuffer: new FrameBuffer(this.#gl, this.#lightingProgram, {
          o_lighting: gBuffer.lighting[TEXTURE],
        }),
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
          u_albedoTexture: this.#gBuffer!.albedo,
          u_normalTexture: this.#gBuffer!.normal,
          u_specularTexture: this.#gBuffer!.specular,
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
  }

  addDirectionalLight(
    light: ScreenSpaceDirectionalLight
  ): DeferredSpriteEffect {
    this.#pendingDirectionalLights.push({
      mvp: FULL_MVP,
      ambient: light.ambient,
      diffuse: light.diffuse,
      direction: light.direction,
      radius: 0,
    });
    return this;
  }

  addPointLight(light: ScreenSpacePointLight): DeferredSpriteEffect {
    if (light.height >= light.radius) {
      // doesn't intersect the ground plane, so disregard the light
      return this;
    }

    const intersectingRadius = Math.sqrt(
      light.radius * light.radius - light.height * light.height
    );

    const mvp = mat3.create();
    mat3.translate(mvp, mvp, [
      light.position[0] - intersectingRadius,
      light.position[1] - intersectingRadius,
    ]);
    mat3.scale(mvp, mvp, [intersectingRadius * 2, intersectingRadius * 2]);
    mat3.multiply(mvp, SpriteViewProjection, mvp);

    this.#pendingPointLights.push({
      mvp,
      ambient: BLACK,
      diffuse: light.diffuse,
      direction: vec3.fromValues(
        light.position[0],
        light.height,
        light.position[1]
      ),
      radius: light.radius,
    });
    return this;
  }

  getLightingTexture(): GPUTexture | undefined {
    return this.#gBuffer?.lighting;
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
