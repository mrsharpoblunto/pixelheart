import { MapTile } from "./map-format";

export type EditorAction =
  | {
      type: "TILE_CHANGE";
      x: number;
      y: number;
      value: MapTile;
    }
  | {
      type: "RESTART";
    };
