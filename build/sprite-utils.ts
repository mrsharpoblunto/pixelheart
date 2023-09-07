import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { OverlayOptions } from "sharp";
import Aseprite from "ase-parser";
import { mat3, vec4, vec3 } from "gl-matrix";
import chalk from "chalk";

export const spritePath = path.join(__dirname, "../sprites");
export const wwwPath = path.join(__dirname, "../www/sprites");
export const spriteSrcPath = path.join(__dirname, "../src/client/sprites");

const PNG_REGEX = /([a-zA-Z_][a-zA-Z0-9_]*)-([0-9]+)x([0-9]+)\.(png|ase)/;
const DIFFUSE_LAYER = "diffuse";
const HEIGHT_LAYER = "height";
const SPECULAR_LAYER = "specular";
const EMISSIVE_LAYER = "emissive";

const TANGENT = vec3.set(vec3.create(), 0, 0, 1);
const BINORMAL = vec3.set(vec3.create(), -1, 0, 0);
const NORMAL = vec3.set(vec3.create(), 0, -1, 0);
const TBN = mat3.set(
  mat3.create(),
  TANGENT[0],
  BINORMAL[0],
  NORMAL[0],
  TANGENT[1],
  BINORMAL[1],
  NORMAL[1],
  TANGENT[2],
  BINORMAL[2],
  NORMAL[2]
);

const DEFAULT_TANGENT_NORMAL = vec3.normalize(
  vec3.create(),
  vec3.transformMat3(vec3.create(), NORMAL, TBN)
);
const DEFAULT_NORMAL_BG = vec4.fromValues(
  DEFAULT_TANGENT_NORMAL[0] * 128 + 127,
  DEFAULT_TANGENT_NORMAL[1] * 128 + 127,
  DEFAULT_TANGENT_NORMAL[2] * 128 + 127,
  255
);
const NORMAL_ROUGHNESS = 0.001;

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
          r: DEFAULT_NORMAL_BG[0],
          g: DEFAULT_NORMAL_BG[1],
          b: DEFAULT_NORMAL_BG[2],
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
      )} ${width}x${height} ${t.to - t.from + 1} frame(s)...`
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
              input: await normalizeCell(c, width, height, {
                r: 0,
                g: 0,
                b: 0,
                alpha: 0,
              }).toBuffer(),
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
              input: await normalizeCell(c, width, height, {
                r: 0,
                g: 0,
                b: 0,
                alpha: 0,
              }).toBuffer(),
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
              {
                r: DEFAULT_NORMAL_BG[0],
                g: DEFAULT_NORMAL_BG[1],
                b: DEFAULT_NORMAL_BG[2],
                alpha: 255,
              },
              toTangentNormal()
            );
            break;
          case SPECULAR_LAYER:
            specularLayer = normalizeCell(c, width, height, {
              r: 0,
              g: 0,
              b: 0,
              alpha: 0,
            });
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
            background: { r: 0, g: 0, b: 255, alpha: 255 },
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

type PixelProcessor = (
  x: number,
  y: number,
  px: (xp: number, yp: number) => vec4
) => vec4;

// converts the heightmap to a tangent space normal map by taking the
// heights around each pixel, using a sobel operator to calculate edge gradients,
// calculating a new normal based off that and then converting that normal into
// tangent space
function toTangentNormal(): PixelProcessor {
  const vecStorage = [
    vec3.create(),
    vec3.create(),
    vec3.create(),
    vec3.create(),
    vec3.create(),
    vec3.create(),
  ];

  return (x, y, px) => {
    const vh00 = px(x - 1, y - 1);
    const vh10 = px(x, y - 1);
    const vh20 = px(x + 1, y - 1);
    const vh01 = px(x - 1, y);
    const vh21 = px(x + 1, y);
    const vh02 = px(x - 1, y + 1);
    const vh12 = px(x, y + 1);
    const vh22 = px(x + 1, y + 1);

    // transparent pixels have a height of 0
    const h00 = Math.min(vh00[0], vh00[3]);
    const h10 = Math.min(vh10[0], vh10[3]);
    const h20 = Math.min(vh20[0], vh20[3]);
    const h01 = Math.min(vh01[0], vh01[3]);
    const h21 = Math.min(vh21[0], vh21[3]);
    const h02 = Math.min(vh02[0], vh02[3]);
    const h12 = Math.min(vh12[0], vh12[3]);
    const h22 = Math.min(vh22[0], vh22[3]);

    // The Sobel operator X kernel is:
    // [ 1.0  0.0  -1.0 ]
    // [ 2.0  0.0  -2.0 ]
    // [ 1.0  0.0  -1.0 ]
    const gx = 2 * (h00 - h20 + 2.0 * h01 - 2.0 * h21 + h02 - h22);

    // The Sobel operator Z kernel is:
    // [  1.0    2.0    1.0 ]
    // [  0.0    0.0    0.0 ]
    // [ -1.0   -2.0   -1.0 ]
    const gz = 2 * (h00 + 2.0 * h10 + h20 - h02 - 2.0 * h12 - h22);

    const scaledZNormal = vec3.scale(
      vecStorage[0],
      NORMAL,
      gz * NORMAL_ROUGHNESS
    );
    const scaledXNormal = vec3.scale(
      vecStorage[1],
      NORMAL,
      gx * NORMAL_ROUGHNESS
    );
    const tangentDisplacement = vec3.subtract(
      vecStorage[2],
      TANGENT,
      scaledZNormal
    );
    const binormalDisplacement = vec3.subtract(
      vecStorage[3],
      BINORMAL,
      scaledXNormal
    );
    const localNormal = vec3.cross(
      vecStorage[4],
      tangentDisplacement,
      binormalDisplacement
    );
    const tangentNormal = vec3.normalize(
      vecStorage[5],
      vec3.transformMat3(vec3.create(), localNormal, TBN)
    );

    return vec4.fromValues(
      tangentNormal[0] * 128 + 127,
      tangentNormal[1] * 128 + 127,
      tangentNormal[2] * 128 + 127,
      255
    );
  };
}

/**
 * Resize a cell such that it is widthxheight and and only the data
 * from the cell in the viewport 0,0 -> widthxheight is present
 */
function normalizeCell(
  c: Aseprite.Cel,
  width: number,
  height: number,
  background: { r: number; g: number; b: number; alpha: number },
  process?: (x: number, y: number, px: (xp: number, yp: number) => vec4) => vec4
): sharp.Sharp {
  let src = c.rawCelData;
  if (process) {
    const dest = Buffer.from(src);
    const px = (x: number, y: number) => {
      if (x >= c.w || x < 0 || y >= c.h || y < 0) {
        return vec4.create();
      }
      return vec4.fromValues(
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

  const extractWidth = Math.min(
    c.w + Math.min(c.xpos, 0),
    width - Math.max(c.xpos, 0)
  );
  const extractHeight = Math.min(
    c.h + Math.min(c.ypos, 0),
    height - Math.max(c.ypos, 0)
  );
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
      background,
    });
}
