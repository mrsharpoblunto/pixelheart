import { vec3, mat3 } from "gl-matrix";

export interface SpriteConfig {
  readonly width: number;
  readonly height: number;
  readonly index: number;
  readonly frames: Array<{
    readonly top: number;
    readonly left: number;
    readonly bottom: number;
    readonly right: number;
  }>;
}

export interface SpriteSheetConfig {
  name: string;
  urls: {
    diffuse: string;
    normal: string;
    specular: string;
    emissive: string;
  };
  indexes: Array<string>;
  sprites: Record<string, SpriteConfig>;
}

export const Tangent = vec3.set(vec3.create(), 0, 1, 0);
export const Normal = vec3.set(vec3.create(), 0, 0, 1);
export const Binormal = vec3.cross(vec3.create(), Tangent, Normal);

export const TBN = mat3.set(
  mat3.create(),
  Tangent[0],
  Binormal[0],
  Normal[0],
  Tangent[1],
  Binormal[1],
  Normal[1],
  Tangent[2],
  Binormal[2],
  Normal[2]
);

export const ToTangentSpace = mat3.transpose(mat3.create(), TBN);
