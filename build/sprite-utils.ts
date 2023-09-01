import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { OverlayOptions } from "sharp";
import Aseprite from "ase-parser";
import { vec4 } from "gl-matrix";
import chalk from "chalk";

export const spritePath = path.join(__dirname, "../sprites");
export const wwwPath = path.join(__dirname, "../www/sprites");
export const spriteSrcPath = path.join(__dirname, "../src/client/sprites");

const PNG_REGEX = /([a-zA-Z_][a-zA-Z0-9_]*)-([0-9]+)x([0-9]+)\.(png|ase)/;
const DIFFUSE_LAYER = "diffuse";
const HEIGHT_LAYER = "height";
const SPECULAR_LAYER = "specular";
const EMISSIVE_LAYER = "emissive";

interface Sprite {
  width: number;
  height: number;
  frames: Array<{
    top: number;
    left: number;
    bottom: number;
    right: number;
  }>;
}

interface SpriteSheet {
  name: string;
  width: number;
  height: number;
  sprites: Map<string, Sprite>;
}

interface SpriteCompositeQueue {
  diffuse: Array<OverlayOptions>;
  normalSpecular: Array<OverlayOptions>;
  emissive: Array<OverlayOptions>;
}

export async function ensurePath(pathName: string) {
  try {
    await fs.mkdir(pathName, { recursive: true });
  } catch (ex) {
    if ((ex as NodeJS.ErrnoException).code !== "EEXIST") {
      throw ex;
    }
  }
}

export function isSpriteSource(p: string): boolean {
  return path.extname(p) === ".png" || path.extname(p) === ".ase";
}

export async function processSpriteSheet(
  spriteSheetName: string,
  log: (message: string) => void,
  onError: (error: string) => void
): Promise<void> {
  const sheet: SpriteSheet = {
    name: spriteSheetName,
    width: 0,
    height: 0,
    sprites: new Map(),
  };

  log(`Building sprite sheet ${chalk.green(sheet.name)}...`);

  const sprites = await fs.readdir(path.join(spritePath, sheet.name));
  const compositeQueue = {
    diffuse: [],
    normalSpecular: [],
    emissive: [],
  };
  for (let sprite of sprites) {
    try {
      if (isSpriteSource(sprite)) {
        log(`Processing file ${sprite}...`);
      } else {
        continue;
      }

      switch (path.extname(sprite)) {
        case ".png":
          await processPngSprite(sprite, sheet, compositeQueue, log, onError);
          break;

        case ".ase":
          await processAseSprite(sprite, sheet, compositeQueue, log, onError);
          break;
        default:
          onError(`Invalid sprite format: ${sprite}`);
      }
    } catch (ex: any) {
      return onError(`Unexpected sprite error: ${ex.toString()}`);
    }
  }

  await fs.writeFile(
    path.join(spriteSrcPath, `${sheet.name}.ts`),
    `const Sheet = { 
  sprites: {
` +
      [...sheet.sprites]
        .map(([name, sprite]) => `   ${name}: ${JSON.stringify(sprite)},`)
        .join("\n") +
      `
  },
  urls: {
    diffuse: "./sprites/${sheet.name}-diffuse.png",
    normalSpecular: "./sprites/${sheet.name}-normal.png",
    emissive: "./sprites/${sheet.name}-emissive.png",
  }
};
export default Sheet;`
  );

  if (sheet.sprites.size) {
    try {
      await Promise.all([
        writeSpriteSheetLayer(sheet, "-diffuse", compositeQueue.diffuse, {
          r: 0,
          g: 0,
          b: 0,
          alpha: 0,
        }),
        writeSpriteSheetLayer(sheet, "-normal", compositeQueue.normalSpecular, {
          r: 0,
          g: 0,
          b: 255,
          alpha: 0,
        }),
        writeSpriteSheetLayer(sheet, "-emissive", compositeQueue.emissive, {
          r: 0,
          g: 0,
          b: 0,
          alpha: 0,
        }),
      ]);
    } catch (err: any) {
      onError(`Failed to write spritesheet: ${err.toString()}`);
    }
  }

  log(`Completed ${chalk.green(sheet.name)}.`);
}

async function writeSpriteSheetLayer(
  sheet: SpriteSheet,
  sheetSuffix: string,
  compositeQueue: Array<OverlayOptions>,
  background: { r: number; g: number; b: number; alpha: number }
): Promise<void> {
  await sharp({
    create: {
      width: sheet.width,
      height: sheet.height,
      channels: 4,
      background,
    },
  })
    .composite(compositeQueue)
    .png()
    .toFile(path.join(wwwPath, `${sheet.name}${sheetSuffix}.png`));
}

async function processPngSprite(
  sprite: string,
  sheet: SpriteSheet,
  compositeQueue: SpriteCompositeQueue,
  log: (message: string) => void,
  onError: (error: string) => void
): Promise<void> {
  const result = PNG_REGEX.exec(sprite);
  if (!result) {
    return onError("Invalid sprite metadata");
  }

  const name = result[1];
  const width = parseInt(result[2], 10);
  const height = parseInt(result[3], 10);
  const image = sharp(path.join(spritePath, sheet.name, sprite));

  let metadata: { width?: number; height?: number } = {};
  try {
    metadata = await image.metadata();
  } catch (err: any) {}

  if (metadata.width && metadata.height) {
    if (metadata.width !== width && metadata.width % width !== 0) {
      return onError(
        `Invalid sprite width ${metadata.width}, must be a multiple of ${width}`
      );
    }
    if (metadata.height !== height) {
      return onError(
        `Invalid sprite width ${metadata.height}, must be equal to ${height}`
      );
    }

    log(
      `Adding sprite ${chalk.green(sheet.name)}:${chalk.blue(
        name
      )} ${width}x${height} ${metadata.width / width} frame(s)...`
    );

    compositeQueue.diffuse.push({
      input: await image.ensureAlpha().raw().toBuffer(),
      left: 0,
      top: sheet.height,
      blend: "over",
      raw: {
        width: metadata.width,
        height,
        channels: 4,
      },
    });

    const outputSprite: Sprite = {
      width,
      height,
      frames: [],
    };

    for (let i = 0; i < metadata.width / width; ++i) {
      outputSprite.frames.push({
        top: sheet.height,
        left: i * width,
        bottom: sheet.height + height,
        right: (i + 1) * width,
      });
    }
    sheet.width = Math.max(sheet.width, metadata.width);
    sheet.height += metadata.height;
    sheet.sprites.set(name, outputSprite);
  } else {
    return onError("Invalid sprite metadata");
  }
}

async function processAseSprite(
  sprite: string,
  sheet: SpriteSheet,
  compositeQueue: SpriteCompositeQueue,
  log: (message: string) => void,
  onError: (error: string) => void
): Promise<void> {
  const buffer = await fs.readFile(path.join(spritePath, sheet.name, sprite));
  const aseFile = new Aseprite(buffer, sprite);
  aseFile.parse();

  const width = aseFile.width;
  const height = aseFile.height;
  for (let t of aseFile.tags) {
    const frameSlice = aseFile.frames.slice(t.from, t.to + 1);
    log(
      `Adding sprite ${chalk.green(sheet.name)}:${chalk.blue(
        t.name
      )} ${width}x${height} ${t.to - t.from} frame(s)...`
    );

    const outputSprite: Sprite = {
      width,
      height,
      frames: frameSlice.map((_f, i) => ({
        top: sheet.height,
        left: i * width,
        bottom: sheet.height + height,
        right: (i + 1) * width,
      })),
    };

    for (let i = 0; i < frameSlice.length; ++i) {
      const f = frameSlice[i];
      let specularLayer: sharp.Sharp | null = null;
      let normalLayer: sharp.Sharp | null = null;
      let hasDiffuse = false;

      for (let c of f.cels) {
        const layer = aseFile.layers[c.layerIndex];
        switch (layer.name.toLowerCase()) {
          case DIFFUSE_LAYER:
            hasDiffuse = true;
            compositeQueue.diffuse.push({
              left: i * width,
              top: sheet.height,
              input: await normalizeCell(c, width, height).toBuffer(),
              blend: "over",
              raw: {
                width,
                height,
                channels: 4,
              },
            });
            break;
          case EMISSIVE_LAYER:
            compositeQueue.emissive.push({
              left: i * width,
              top: sheet.height,
              input: await normalizeCell(c, width, height).toBuffer(),
              blend: "over",
              raw: {
                width,
                height,
                channels: 4,
              },
            });
            break;
          case HEIGHT_LAYER:
            normalLayer = normalizeCell(
              c,
              width,
              height,
              (x: number, y: number, px: (xp: number, yp: number) => vec4) => {
                // TODO calculate TBN basis & the normal vector from the heights around the pixel using a sobel kernel
                return px(x, y);
              }
            );
            break;
          case SPECULAR_LAYER:
            specularLayer = normalizeCell(c, width, height);
            break;
        }
      }

      if (!hasDiffuse) {
        return onError('No "diffuse" layer found');
      }

      specularLayer =
        specularLayer ||
        sharp({
          create: {
            width,
            height,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          },
        });
      const specularBuffer = await specularLayer.extractChannel(3).toBuffer();

      normalLayer =
        normalLayer ||
        sharp({
          create: {
            width,
            height,
            channels: 4,
            background: { r: 0, g: 0, b: 255, alpha: 0 },
          },
        });
      const normalBuffer = await normalLayer.removeAlpha().toBuffer();

      compositeQueue.normalSpecular.push({
        // take the specular channel and merge it with the normal RGB
        input: await sharp(normalBuffer, {
          raw: { width, height, channels: 3 },
        })
          .joinChannel(specularBuffer, {
            raw: {
              width,
              height,
              channels: 1,
            },
          })
          .toBuffer(),
        top: sheet.height,
        left: width * i,
        blend: "over",
        raw: {
          width,
          height,
          channels: 4,
        },
      });
    }

    sheet.width = Math.max(sheet.width, outputSprite.width * frameSlice.length);
    sheet.height += outputSprite.height;
    sheet.sprites.set(t.name, outputSprite);
  }
}

/**
 * Resize a cell such that it is widthxheight and and only the data
 * from the cell in the viewport 0,0 -> widthxheight is present
 */
function normalizeCell(
  c: Aseprite.Cel,
  width: number,
  height: number,
  process?: (x: number, y: number, px: (xp: number, yp: number) => vec4) => vec4
): sharp.Sharp {
  let src = c.rawCelData;
  if (process) {
    const dest = Buffer.from(src);
    const px = (x: number, y: number) => {
      if (x >= c.w || x < 0 || y >= c.h || y < 0) {
        return vec4.create();
      }
      return vec4.set(
        vec4.create(),
        src[y * c.w * 4 + x * 4],
        src[y * c.w * 4 + x * 4 + 1],
        src[y * c.w * 4 + x * 4 + 2],
        src[y * c.w * 4 + x * 4 + 3]
      );
    };
    for (let y = 0; y < c.h; ++y) {
      for (let x = 0; x < c.w; ++x) {
        const p = process(x, y, px);
        dest[y * c.w * 4 + x * 4] = p[0];
        dest[y * c.w * 4 + x * 4 + 1] = p[1];
        dest[y * c.w * 4 + x * 4 + 2] = p[2];
        dest[y * c.w * 4 + x * 4 + 3] = p[3];
      }
    }
    src = dest;
  }

  const extractWidth = Math.min(c.w + Math.min(c.xpos, 0), width);
  const extractHeight = Math.min(c.h + Math.min(c.ypos, 0), height);
  const topPadding = Math.max(0, c.ypos);
  const leftPadding = Math.max(0, c.xpos);

  return sharp(src, {
    raw: { width: c.w, height: c.h, channels: 4 },
  })
    .extract({
      width: extractWidth,
      height: extractHeight,
      left: Math.abs(Math.min(0, c.xpos)),
      top: Math.abs(Math.min(0, c.ypos)),
    })
    .extend({
      top: topPadding,
      left: leftPadding,
      bottom: Math.max(0, height - extractHeight - topPadding),
      right: Math.max(0, width - extractWidth - leftPadding),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
}
