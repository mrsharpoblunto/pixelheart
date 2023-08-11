import { vec2, vec4 } from "gl-matrix";

export const TILE_SIZE = 16;

export function toAbsoluteFromRelative(
  out: vec2,
  relative: vec2,
  screen: { absolutePosition: vec2 }
): vec2 {
  return vec2.add(out, relative, screen.absolutePosition);
}

export function toRelativeFromAbsolute(
  out: vec2,
  absolute: vec2,
  screen: { absolutePosition: vec2 }
): vec2 {
  return vec2.subtract(out, absolute, screen.absolutePosition);
}

export function toAbsoluteTileFromAbsolute(out: vec4, absolute: vec2): vec4 {
  return vec4.set(
    out,
    Math.floor(absolute[0] / TILE_SIZE),
    Math.floor(absolute[1] / TILE_SIZE),
    Math.floor(absolute[0]) % TILE_SIZE,
    Math.floor(absolute[1]) % TILE_SIZE
  );
}

export function toAbsoluteTileFromRelative(
  out: vec4,
  relative: vec2,
  screen: { absolutePosition: vec2 }
): vec4 {
  const absolute = vec2.create();
  toAbsoluteFromRelative(absolute, relative, screen);
  return vec4.set(
    out,
    Math.floor(absolute[0] / TILE_SIZE),
    Math.floor(absolute[1] / TILE_SIZE),
    Math.floor(absolute[0]) % TILE_SIZE,
    Math.floor(absolute[1]) % TILE_SIZE
  );
}

export function toRelativeTileFromAbsolute(
  out: vec4,
  absolute: vec2,
  screen: { absolutePosition: vec2 }
): vec4 {
  const relative = vec2.create();
  toRelativeFromAbsolute(relative, absolute, screen);
  return vec4.set(
    out,
    Math.floor(relative[0] / TILE_SIZE),
    Math.floor(relative[1] / TILE_SIZE),
    Math.floor(relative[0]) % TILE_SIZE,
    Math.floor(relative[1]) % TILE_SIZE
  );
}

export function toRelativeTileFromAbsoluteTile(
  out: vec4,
  absoluteTile: vec4,
  screen: { absolutePosition: vec2 }
): vec4 {
  const ssp = toAbsoluteTileFromAbsolute(
    vec4.create(),
    screen.absolutePosition
  );

  return vec4.set(
    out,
    absoluteTile[0] - ssp[0],
    absoluteTile[1] - ssp[1],
    ssp[2],
    ssp[3]
  );
}

export function toRelativeTileFromRelative(
  out: vec4,
  relative: vec2,
  screen: { absolutePosition: vec2 }
): vec4 {
  const ssp = toAbsoluteTileFromAbsolute(
    vec4.create(),
    screen.absolutePosition
  );

  toAbsoluteTileFromRelative(out, relative, screen);

  return vec4.set(out, out[0] - ssp[0], out[1] - ssp[1], ssp[2], ssp[3]);
}

export function toRelativeFromRelativeTile(
  out: vec4,
  relativeTile: vec4,
  scale: number = 1
): vec4 {
  return vec4.set(
    out,
    relativeTile[1] * TILE_SIZE - relativeTile[3],
    relativeTile[0] * TILE_SIZE + TILE_SIZE * scale - relativeTile[2],
    relativeTile[1] * TILE_SIZE + TILE_SIZE * scale - relativeTile[3],
    relativeTile[0] * TILE_SIZE - relativeTile[2]
  );
}
