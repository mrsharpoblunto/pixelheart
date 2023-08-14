export type EditorAction =
  | {
      type: "TILE_CHANGE";
      x: number;
      y: number;
      value: number;
    }
  | {
      type: "RESTART";
    };
