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