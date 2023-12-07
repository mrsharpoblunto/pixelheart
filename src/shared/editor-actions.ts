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
