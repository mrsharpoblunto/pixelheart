import { vec2, vec4 } from "gl-matrix";

import { GameContext } from "./game.js";
import * as coords from "./coordinates.js";
import { CPUReadableTexture } from "./images.js";
import { loadCPUReadableTextureFromUrl } from "./images.js";
import { SpriteSheet, SpriteSheetConfig, loadSpriteSheet } from "./sprite.js";

export interface MapTile {
  index: number; // 0-255
  walkable: boolean;
  spatialHash: boolean;
  animated: boolean;
  triggerId: number;
}

export interface MapTileSource {
  sprite: string;
  walkable: boolean;
  spatialHash: boolean;
  animated: boolean;
  triggerId: number;
}

export function decodeMapTile(
  buffer: Uint8ClampedArray | Buffer,
  index: number
): MapTile {
  return {
    index: buffer[index],
    triggerId: buffer[index + 1],
    walkable: (buffer[index + 2] & 1) === 1,
    spatialHash: (buffer[index + 2] & 2) === 2,
    animated: (buffer[index + 2] & 4) === 4,
  };
}

export function encodeMapTile(
  buffer: Uint8ClampedArray | Buffer,
  index: number,
  value: MapTile
) {
  buffer[index] = value.index;
  buffer[index + 1] = value.triggerId;
  buffer[index + 2] =
    (value.walkable ? 1 : 0) |
    (value.spatialHash ? 2 : 0) |
    (value.animated ? 4 : 0);
}
export interface MapContainer<T> {
  data: MapData;
  sprite: SpriteSheet<T>;
  spriteConfig: SpriteSheetConfig;
}

export async function loadMapContainer<T>(
  ctx: GameContext,
  tileSize: number,
  map: { spriteSheet: SpriteSheetConfig; url: string },
  loader: (ctx: GameContext, sheet: SpriteSheetConfig) => Promise<T>
): Promise<MapContainer<T>> {
  const [sprite, m] = await Promise.all([
    loadSpriteSheet(ctx, map.spriteSheet, loader),
    loadCPUReadableTextureFromUrl(ctx, map.url),
  ]);
  return {
    data: new MapData(ctx, tileSize, m),
    sprite,
    spriteConfig: map.spriteSheet,
  };
}

export class MapData {
  buffer: ImageData;
  width: number;
  height: number;
  tileSize: number;
  bufferPosition: vec4;
  lastScreenPosition: vec2;
  lastScreenWidth: number;
  lastScreenHeight: number;
  offscreen: CanvasRenderingContext2D;

  constructor(ctx: GameContext, tileSize: number, map: CPUReadableTexture) {
    this.offscreen = ctx.createOffscreenCanvas(map.width, map.height, {
      willReadFrequently: true,
    });
    this.offscreen.drawImage(map.image, 0, 0, map.width, map.height);
    this.width = map.width;
    this.height = map.height;
    this.tileSize = tileSize;
    this.buffer = new ImageData(
      ctx.screen.width / tileSize + 3,
      ctx.screen.height / tileSize + 3
    );

    this.bufferPosition = vec4.create();
    this.lastScreenPosition = vec2.create();
    this.lastScreenWidth = 0;
    this.lastScreenHeight = 0;
  }

  updateScreenBuffer(ctx: GameContext, screenAbsolutePosition: vec2) {
    if (
      this.lastScreenWidth !== ctx.screen.width ||
      this.lastScreenHeight !== ctx.screen.height ||
      this.lastScreenPosition[0] !== screenAbsolutePosition[0] ||
      this.lastScreenPosition[1] !== screenAbsolutePosition[1]
    ) {
      const ssp = coords.toAbsoluteTileFromAbsolute(
        vec4.create(),
        screenAbsolutePosition
      );

      this.bufferPosition = vec4.fromValues(
        ssp[0] - 1,
        ssp[1] - 1,
        ctx.screen.width / this.tileSize + 3,
        ctx.screen.height / this.tileSize + 3
      );

      // read in all the onscreen tiles
      this.buffer = this.offscreen.getImageData(
        this.bufferPosition[0],
        this.bufferPosition[1],
        this.bufferPosition[2],
        this.bufferPosition[3]
      );

      this.lastScreenPosition = vec2.clone(screenAbsolutePosition);
      this.lastScreenWidth = ctx.screen.width;
      this.lastScreenHeight = ctx.screen.height;
    }
  }

  read(x: number, y: number): MapTile {
    if (
      x >= this.bufferPosition[0] &&
      x < this.bufferPosition[0] + this.bufferPosition[2] &&
      y >= this.bufferPosition[1] &&
      y < this.bufferPosition[1] + this.bufferPosition[3]
    ) {
      // reading inside the visible screen buffer, fast case
      x -= this.bufferPosition[0];
      y -= this.bufferPosition[1];
      const index = 4 * (this.buffer.width * y + x);
      return decodeMapTile(this.buffer.data, index);
    } else {
      // reading outside of the visible screen, slower, but less common
      const buff = this.offscreen.getImageData(x, y, 1, 1);
      return decodeMapTile(buff.data, 0);
    }
  }

  write(x: number, y: number, value: MapTile) {
    if (
      x >= this.bufferPosition[0] &&
      x < this.bufferPosition[0] + this.bufferPosition[2] &&
      y >= this.bufferPosition[1] &&
      y < this.bufferPosition[1] + this.bufferPosition[3]
    ) {
      x -= this.bufferPosition[0];
      y -= this.bufferPosition[1];
      const index = 4 * (this.buffer.width * y + x);
      encodeMapTile(this.buffer.data, index, value);
      this.offscreen.putImageData(
        this.buffer,
        this.bufferPosition[0],
        this.bufferPosition[1]
      );
    } else {
      const buff = new ImageData(1, 1);
      encodeMapTile(buff.data, 0, value);
      this.offscreen.putImageData(buff, x, y);
    }
  }
}
