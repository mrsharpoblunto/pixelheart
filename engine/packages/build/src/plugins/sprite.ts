import Aseprite from "ase-parser";
import chalk from "chalk";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { OverlayOptions } from "sharp";

import {
  Binormal,
  Normal,
  SpriteConfig,
  SpriteSheetConfig,
  Tangent,
  ToTangentSpace,
} from "@pixelheart/client";
import { vec3, vec4 } from "@pixelheart/client/gl-matrix";

import { ensurePath, getFileHash } from "../file-utils.js";
import { BuildContext, BuildWatchEvent, BuildPlugin } from "../plugin.js";

const PNG_REGEX = /([a-zA-Z_][a-zA-Z0-9_]*)-([0-9]+)x([0-9]+)\.(png|ase)/;
const DIFFUSE_LAYER = "diffuse";
const HEIGHT_LAYER = "height";
const SPECULAR_LAYER = "specular";
const EMISSIVE_LAYER = "emissive";
const SHEET_FORMAT = "png";

const DEFAULT_TANGENT_NORMAL = vec3.normalize(
  vec3.create(),
  vec3.transformMat3(vec3.create(), Normal, ToTangentSpace)
);
const DEFAULT_NORMAL_BG = vec4.fromValues(
  DEFAULT_TANGENT_NORMAL[0] * 128 + 127,
  DEFAULT_TANGENT_NORMAL[1] * 128 + 127,
  DEFAULT_TANGENT_NORMAL[2] * 128 + 127,
  255
);
const NORMAL_ROUGHNESS = 0.001;

interface PendingSpriteSheet {
  name: string;
  width: number;
  height: number;
  sprites: Map<string, SpriteConfig>;
}

interface SpriteCompositeQueue {
  diffuse: Array<OverlayOptions>;
  normal: Array<OverlayOptions>;
  specular: Array<OverlayOptions>;
  emissive: Array<OverlayOptions>;
}

export default class SpritePlugin implements BuildPlugin {
  depends = [];

  #getPaths(ctx: BuildContext) {
    return {
      sprites: path.join(ctx.gameAssetPath, "sprites"),
      output: path.join(ctx.gameOutputPath, "sprites"),
      spriteSrc: path.join(ctx.gameClientPath, "sprites"),
    };
  }

  async init(ctx: BuildContext): Promise<boolean> {
    const paths = this.#getPaths(ctx);
    if (existsSync(paths.sprites)) {
      await ensurePath(paths.output);
      await ensurePath(paths.spriteSrc);
      return true;
    } else {
      return false;
    }
  }

  async clean(ctx: BuildContext) {
    const paths = this.#getPaths(ctx);
    try {
      await Promise.all([
        fs.rm(paths.output, {
          recursive: true,
          force: true,
        }),
        fs.rm(paths.spriteSrc, {
          recursive: true,
          force: true,
        }),
      ]);
    } catch (e) { }
  }

  async build(ctx: BuildContext) {
    const paths = this.#getPaths(ctx);

    // on first run, check if any sprites are missing or older
    // than the source and build them
    const sourceSpriteSheets = await fs.readdir(paths.sprites);
    const destSpriteSheets = !ctx.clean ? await fs.readdir(paths.output) : [];
    for (const src of sourceSpriteSheets) {
      const srcStat = await fs.stat(path.join(paths.sprites, src));
      if (srcStat.isFile()) {
        continue;
      }
      const dest = destSpriteSheets.find(
        (d) =>
          d === `${src}-diffuse.png` ||
          d === `${src}-normal.png` ||
          d === `${src}-emissive.png`
      );
      if (
        // doesn't exist
        !dest ||
        // or is older than the source
        srcStat.mtimeMs > (await fs.stat(path.join(paths.output, dest))).mtimeMs
      ) {
        await this.#processSpriteSheet(ctx, src);
      }
    }
  }

  async watch(ctx: BuildContext, subscribe: (path: string, callback: (err: Error | null, events: Array<BuildWatchEvent>) => void) => Promise<any>) {
    const paths = this.#getPaths(ctx);
    // await other sprite changes as they come
    await subscribe(paths.sprites, async (_err, events) => {
      await this.#processSpriteSheetEvents(ctx, events);
    });
  }

  async #processSpriteSheetEvents(ctx: BuildContext, events: Array<BuildWatchEvent>) {
    const paths = this.#getPaths(ctx);
    const newOrModified = new Set<string>();
    const deleted = [];
    for (let e of events) {
      const components = e.path.substring(paths.sprites.length + 1).split("/");
      switch (e.type) {
        case "create":
        case "update":
          {
            // if the spritesheet or a png has been added/changed. We ignore
            // other stuff because image editing apps can create tmp files while saving etc..
            if (components.length === 1 || isSpriteSource(e.path)) {
              newOrModified.add(components[0]);
            }
          }
          break;

        case "delete":
          {
            // if its a toplevel spritesheet directory, remove the spritesheet
            // if its a sprite in a sheet, modify the spritesheet
            if (components.length === 1) {
              ctx.log("sprite",`Removing sprite sheet ${components[0]}...`);
              deleted.push(components[0]);
            } else if (isSpriteSource(e.path)) {
              newOrModified.add(components[0]);
            }
          }
          break;
      }
    }

    for (let d of deleted) {
      try {
        await fs.rm(path.join(paths.spriteSrc, `${d}.ts`));
        await fs.rm(path.join(paths.output, `${d}.png`));
      } catch (ex) { }
    }

    for (let nom of newOrModified) {
      const spriteSheet = await this.#processSpriteSheet(ctx, nom);
      if (spriteSheet) {
        ctx.emit({
          type: "RELOAD_SPRITESHEET",
          spriteSheet,
        });
      }
    }
  }

  async #processSpriteSheet(
    ctx: BuildContext,
    spriteSheetName: string
  ): Promise<SpriteSheetConfig | null> {
    const paths = this.#getPaths(ctx);
    let config: SpriteSheetConfig | null = null;
    const sheet: PendingSpriteSheet = {
      name: spriteSheetName,
      width: 0,
      height: 0,
      sprites: new Map(),
    };

    ctx.log("sprite",`Building sprite sheet ${chalk.green(sheet.name)}...`);

    const sprites = await fs.readdir(path.join(paths.sprites, sheet.name));
    const compositeQueue = {
      diffuse: [],
      normal: [],
      specular: [],
      emissive: [],
    };
    for (let sprite of sprites) {
      try {
        if (isSpriteSource(sprite)) {
          ctx.log("sprite",`Processing file ${sprite}...`);
        } else {
          continue;
        }

        switch (path.extname(sprite)) {
          case ".png":
            await this.#processPngSprite(ctx, sprite, sheet, compositeQueue);
            break;

          case ".ase":
            await this.#processAseSprite(ctx, sprite, sheet, compositeQueue);
            break;
          default:
            ctx.error("sprite",`Invalid sprite format: ${sprite}`);
        }
      } catch (ex: any) {
        ctx.error("sprite",`Unexpected sprite error: ${ex.toString()}`);
        return null;
      }
    }

    if (sheet.sprites.size) {
      try {
        const urls = await Promise.all([
          this.#writeSpriteSheetLayer(
            ctx,
            "diffuse",
            sheet,
            compositeQueue.diffuse,
            {
              r: 0,
              g: 0,
              b: 0,
              alpha: 0,
            }
          ),
          this.#writeSpriteSheetLayer(
            ctx,
            "emissive",
            sheet,
            compositeQueue.emissive,
            {
              r: 0,
              g: 0,
              b: 0,
              alpha: 0,
            }
          ),
          this.#writeSpriteSheetLayer(
            ctx,
            "normal",
            sheet,
            compositeQueue.normal,
            {
              r: DEFAULT_NORMAL_BG[0],
              g: DEFAULT_NORMAL_BG[1],
              b: DEFAULT_NORMAL_BG[2],
              alpha: 255,
            }
          ),
          this.#writeSpriteSheetLayer(
            ctx,
            "specular",
            sheet,
            compositeQueue.specular,
            {
              r: 0,
              g: 0,
              b: 0,
              alpha: 255,
            },
            (s) => s.greyscale()
          ),
        ]);

        config = {
          name: sheet.name,
          sprites: [...sheet.sprites]
            .map(([name, sprite], i) => ({
              name,
              // flip y coordinates to match WebGL's convention
              sprite: { ...sprite, frames: sprite.frames.map(f=>({
                ...f,
                top: sheet.height - f.top,
                bottom: sheet.height - f.bottom,
              })), index: i + 1 },
            }))
            .reduce((p, { name, sprite }) => {
              p[name] = sprite;
              return p;
            }, {} as Record<string, SpriteConfig>),
          indexes: [["", ""], ...sheet.sprites].map(([name, _]) => name),
          urls: urls.reduce((p, [name, url]) => {
            p[name] = url;
            return p;
          }, {} as any),
        };

        // write the typescript generated mapping
        await fs.writeFile(
          path.join(paths.spriteSrc, `${sheet.name}.ts`),
          `const Sheet = ${JSON.stringify(config, null, 2)};
export default Sheet;`
        );

        // write the json reverse index
        await fs.writeFile(
          path.join(paths.spriteSrc, `${sheet.name}.json`),
          `{
  ` +
          [...sheet.sprites]
            .map(([name, _], i) => `"${name}":${i + 1} `)
            .join(",") +
          `} `
        );
      } catch (err: any) {
        ctx.error("sprite",`Failed to write spritesheet: ${err.toString()} `);
      }
    }

    ctx.log("sprite",`Completed ${chalk.green(sheet.name)}.`);
    return config;
  }

  async #writeSpriteSheetLayer(
    ctx: BuildContext,
    sheetType: string,
    sheet: PendingSpriteSheet,
    compositeQueue: Array<OverlayOptions>,
    background: { r: number; g: number; b: number; alpha: number },
    additionalProcessing?: (s: sharp.Sharp) => sharp.Sharp
  ): Promise<[string, string]> {
    const paths = this.#getPaths(ctx);
    const urlPath = `${sheet.name}-${sheetType}.${SHEET_FORMAT}`;
    const filePath = path.join(paths.output, urlPath);
    await (additionalProcessing || ((s) => s))(
      sharp({
        create: {
          width: sheet.width,
          height: sheet.height,
          channels: 4,
          background,
        },
      }).composite(compositeQueue)
    )
      .ensureAlpha()
    [SHEET_FORMAT]({
      compressionLevel: ctx.production ? 9 : 6,
    })
      .toFile(filePath);

    const hash = await getFileHash(filePath);

    return [sheetType, `/sprites/${urlPath}?v=${hash}`];
  }

  async #processPngSprite(
    ctx: BuildContext,
    sprite: string,
    sheet: PendingSpriteSheet,
    compositeQueue: SpriteCompositeQueue
  ): Promise<void> {
    const paths = this.#getPaths(ctx);
    const result = PNG_REGEX.exec(sprite);
    if (!result) {
      return ctx.error("sprite","Invalid sprite metadata");
    }

    const name = result[1];
    const width = parseInt(result[2], 10);
    const height = parseInt(result[3], 10);
    const image = sharp(
      path.join(paths.sprites, sheet.name, sprite)
    );

    let metadata: { width?: number; height?: number } = {};
    try {
      metadata = await image.metadata();
    } catch (err: any) { }

    if (metadata.width && metadata.height) {
      if (metadata.width !== width && metadata.width % width !== 0) {
        return ctx.error("sprite",
          `Invalid sprite width ${metadata.width}, must be a multiple of ${width} `
        );
      }
      if (metadata.height !== height) {
        return ctx.error("sprite",
          `Invalid sprite width ${metadata.height}, must be equal to ${height} `
        );
      }

      ctx.log("sprite",
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

      const outputSprite: SpriteConfig = {
        index: 0,
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
      return ctx.error("sprite","Invalid sprite metadata");
    }
  }

  async #processAseSprite(
    ctx: BuildContext,
    sprite: string,
    sheet: PendingSpriteSheet,
    compositeQueue: SpriteCompositeQueue
  ): Promise<void> {
    const paths = this.#getPaths(ctx);
    const buffer = await fs.readFile(
      path.join(paths.sprites, sheet.name, sprite)
    );
    const aseFile = new Aseprite(buffer, sprite);
    aseFile.parse();

    const width = aseFile.width;
    const height = aseFile.height;
    for (let t of aseFile.tags) {
      const frameSlice = aseFile.frames.slice(t.from, t.to + 1);
      ctx.log("sprite",
        `Adding sprite ${chalk.green(sheet.name)}:${chalk.blue(
          t.name
        )} ${width}x${height} ${t.to - t.from + 1} frame(s)...`
      );

      const outputSprite: SpriteConfig = {
        index: 0,
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
          return ctx.error("sprite",'No "diffuse" layer found');
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

        compositeQueue.specular.push({
          input: await specularLayer.raw().toBuffer(),
          top: sheet.height,
          left: width * i,
          blend: "over",
          raw: {
            width,
            height,
            channels: 4,
          },
        });

        normalLayer =
          normalLayer ||
          sharp({
            create: {
              width,
              height,
              channels: 4,
              background: {
                r: DEFAULT_NORMAL_BG[0],
                g: DEFAULT_NORMAL_BG[1],
                b: DEFAULT_NORMAL_BG[2],
                alpha: 255,
              },
            },
          });

        compositeQueue.normal.push({
          input: await normalLayer.raw().toBuffer(),
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

      sheet.width = Math.max(
        sheet.width,
        outputSprite.width * frameSlice.length
      );
      sheet.height += outputSprite.height;
      sheet.sprites.set(t.name, outputSprite);
    }
  }
}

function isSpriteSource(p: string): boolean {
  return path.extname(p) === ".png" || path.extname(p) === ".ase";
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

    // The Sobel operator Y kernel is:
    // [  1.0    2.0    1.0 ]
    // [  0.0    0.0    0.0 ]
    // [ -1.0   -2.0   -1.0 ]
    const gy = 2 * (h00 + 2.0 * h10 + h20 - h02 - 2.0 * h12 - h22);

    const scaledYNormal = vec3.scale(
      vecStorage[0],
      Normal,
      gy * NORMAL_ROUGHNESS
    );
    const scaledXNormal = vec3.scale(
      vecStorage[1],
      Normal,
      gx * NORMAL_ROUGHNESS
    );
    const tangentDisplacement = vec3.normalize(
      vecStorage[2],
      vec3.subtract(vecStorage[2], Tangent, scaledYNormal)
    );
    const binormalDisplacement = vec3.normalize(
      vecStorage[3],
      vec3.subtract(vecStorage[3], Binormal, scaledXNormal)
    );
    const localNormal = vec3.cross(
      vecStorage[4],
      binormalDisplacement,
      tangentDisplacement
    );
    const tangentNormal = vec3.normalize(
      vecStorage[5],
      vec3.transformMat3(vecStorage[5], localNormal, ToTangentSpace)
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
      x = Math.max(0, Math.min(c.w - 1, x));
      y = Math.max(0, Math.min(c.h - 1, y));
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
