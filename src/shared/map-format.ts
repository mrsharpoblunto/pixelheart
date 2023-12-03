export type MapTile = number;

export function decodeMapTile(
  buffer: Uint8ClampedArray | Buffer,
  index: number
): MapTile {
  return buffer[index];
}

export function encodeMapTile(
  buffer: Uint8ClampedArray | Buffer,
  index: number,
  value: MapTile
) {
  buffer[index] = value;
}
