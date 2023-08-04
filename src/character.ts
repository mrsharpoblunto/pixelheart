import { GPUTexture } from "./images";

export const Sprite = {
  width: 272,
  height: 256,
  animations: {
    down: [
      { top: 0, left: 0, bottom: 32, right: 16 },
      { top: 0, left: 16, bottom: 32, right: 32 },
      { top: 0, left: 32, bottom: 32, right: 48 },
      { top: 0, left: 48, bottom: 32, right: 64 },
    ],
    right: [
      { top: 32, left: 0, bottom: 64, right: 16 },
      { top: 32, left: 16, bottom: 64, right: 32 },
      { top: 32, left: 32, bottom: 64, right: 48 },
      { top: 32, left: 48, bottom: 64, right: 64 },
    ],
    up: [
      { top: 64, left: 0, bottom: 96, right: 16 },
      { top: 64, left: 16, bottom: 96, right: 32 },
      { top: 64, left: 32, bottom: 96, right: 48 },
      { top: 64, left: 48, bottom: 96, right: 64 },
    ],
    left: [
      { top: 96, left: 0, bottom: 128, right: 16 },
      { top: 96, left: 16, bottom: 128, right: 32 },
      { top: 96, left: 32, bottom: 128, right: 48 },
      { top: 96, left: 48, bottom: 128, right: 64 },
    ],
  },
};

interface Sprite {
  animations: {
    [key: string]: Array<{
      top: number;
      left: number;
      bottom: number;
      right: number;
    }>;
  };
  width: number;
  height: number;
}

export interface Character {
  sprite: Sprite;
  texture: GPUTexture;
  direction: string;
  currentFrame: number;
  frameRate: number;
  position: { x: number; y: number };
  speed: number;
}
