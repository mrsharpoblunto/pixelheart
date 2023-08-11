export const TILE_SIZE = 16;

export function toAbsoluteFromRelative(
  relative: { x: number; y: number },
  screen: { absolutePosition: { x: number; y: number } }
): { x: number; y: number } {
  return {
    x: relative.x + screen.absolutePosition.x,
    y: relative.y + screen.absolutePosition.y,
  };
}

export function toRelativeFromAbsolute(
  absolute: { x: number; y: number },
  screen: { absolutePosition: { x: number; y: number } }
): { x: number; y: number } {
  return {
    x: absolute.x - screen.absolutePosition.x,
    y: absolute.y - screen.absolutePosition.y,
  };
}

export function toAbsoluteTileFromAbsolute(absolute: {
  x: number;
  y: number;
}): [{ x: number; y: number }, { x: number; y: number }] {
  return [
    {
      x: Math.floor(absolute.x / TILE_SIZE),
      y: Math.floor(absolute.y / TILE_SIZE),
    },
    {
      x: Math.floor(absolute.x) % TILE_SIZE,
      y: Math.floor(absolute.y) % TILE_SIZE,
    },
  ];
}

export function toAbsoluteTileFromRelative(
  relative: { x: number; y: number },
  screen: { absolutePosition: { x: number; y: number } }
): [{ x: number; y: number }, { x: number; y: number }] {
  const absolute = toAbsoluteFromRelative(relative, screen);
  return [
    {
      x: Math.floor(absolute.x / TILE_SIZE),
      y: Math.floor(absolute.y / TILE_SIZE),
    },
    {
      x: Math.floor(absolute.x) % TILE_SIZE,
      y: Math.floor(absolute.y) % TILE_SIZE,
    },
  ];
}

export function toRelativeTileFromAbsolute(
  absolute: { x: number; y: number },
  screen: { absolutePosition: { x: number; y: number } }
): [{ x: number; y: number }, { x: number; y: number }] {
  const relative = toRelativeFromAbsolute(absolute, screen);
  return [
    {
      x: Math.floor(relative.x / TILE_SIZE),
      y: Math.floor(relative.y / TILE_SIZE),
    },
    {
      x: Math.floor(relative.x) % TILE_SIZE,
      y: Math.floor(relative.y) % TILE_SIZE,
    },
  ];
}

export function toRelativeTileFromRelative(relative: {
  x: number;
  y: number;
}): [{ x: number; y: number }, { x: number; y: number }] {
  return [
    {
      x: Math.floor(relative.x / TILE_SIZE),
      y: Math.floor(relative.y / TILE_SIZE),
    },
    {
      x: Math.floor(relative.x) % TILE_SIZE,
      y: Math.floor(relative.y) % TILE_SIZE,
    },
  ];
}
