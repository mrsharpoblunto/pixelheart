import { MapTileSource } from "./map-format";

export type EditorAction =
  | {
      type: "TILE_CHANGE";
      x: number;
      y: number;
      map: string;
      value: MapTileSource;
    }
  | {
      type: "RESTART";
    };

export type EditorEvent =
  | { type: "RELOAD_MAP"; map: string }
  | { type: "RELOAD_SHADER"; shader: string, src: string }
  | { type: "RELOAD_SPRITESHEET"; spriteSheet: string };
