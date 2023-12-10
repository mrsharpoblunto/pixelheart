import Ajv, { JTDDataType } from "ajv/dist/jtd";
import { ErrorObject } from "ajv";
import sharp from "sharp";
import { encodeMapTile, MapTileSource } from "../src/shared/map-format";
import path from "path";
import chalk from "chalk";
import fs from "fs/promises";
import { spriteSrcPath } from "./sprite-utils";
import { getFileHash } from "./common-utils";

export const mapsPath = path.join(__dirname, "../assets/maps");
export const wwwPath = path.join(__dirname, "../www/maps");
export const mapSrcPath = path.join(__dirname, "../src/client/generated/maps");

const mapSchema = {
  properties: {
    width: { type: "int32" },
    height: { type: "int32" },
    startPosition: {
      properties: {
        x: { type: "int32" },
        y: { type: "int32" },
      },
    },
    spriteSheet: { type: "string" },
  },
} as const;

const ajv = new Ajv();
const validate = ajv.compile<MapMetadata>(mapSchema);

export type MapMetadata = JTDDataType<typeof mapSchema>;

function validateMapMetadata(metadata: Object):
  | {
      ok: true;
      metadata: MapMetadata;
    }
  | { ok: false; errors: ErrorObject<string, Record<string, any>, unknown>[] } {
  if (validate(metadata)) {
    return { ok: true, metadata: metadata as MapMetadata };
  } else {
    return { ok: false, errors: validate.errors! };
  }
}

async function loadJson(file: string): Promise<
  | {
      ok: true;
      data: any;
    }
  | {
      ok: false;
    }
> {
  try {
    return { ok: true, data: JSON.parse(await fs.readFile(file, "utf8")) };
  } catch (ex) {
    return { ok: false };
  }
}

export async function loadMapMetadata(
  map: string
): Promise<
  | { ok: true; metadata: MapMetadata }
  | { ok: false; errors: ErrorObject<string, Record<string, any>, unknown>[] }
> {
  const metadataPath = path.join(mapsPath, map, "metadata.json");
  const metadata = await loadJson(metadataPath);
  if (!metadata.ok) {
    return { ok: false, errors: [] };
  }

  return validateMapMetadata(metadata.data);
}

export async function processMap(
  map: string,
  log: (message: string) => void,
  onError: (error: string) => void
) {
  log(`Building map ${chalk.green(map)}...`);

  const result = await loadMapMetadata(map);
  if (!result.ok) {
    if (result.errors.length > 0) {
      onError(
        `Invalid map metadata: ${result.errors
          .map((e) => e.message)
          .join(", ")}`
      );
    } else {
      onError(`Invalid map metadata: invalid JSON`);
    }
    return;
  }

  log(
    `Generating ${result.metadata.width}x${
      result.metadata.height
    } map using sprite sheet ${chalk.green(result.metadata.spriteSheet)}...`
  );

  const dataPath = path.join(mapsPath, map, "data.json");
  const data = await loadJson(dataPath);

  const mapData = data.ok
    ? (data.data as unknown as {
        [x: string]: { [y: string]: { [z: string]: MapTileSource } };
      })
    : {};
  if (!data.ok) {
    await fs.writeFile(dataPath, JSON.stringify(mapData, null, 2));
  }

  const spriteRevIndex = await loadJson(
    path.join(spriteSrcPath, `${result.metadata.spriteSheet}.json`)
  );

  if (!spriteRevIndex.ok) {
    return onError(`Invalid sprite sheet: ${result.metadata.spriteSheet}`);
  }

  // TODO account for the number of layers in the map
  const mapBuffer = Buffer.alloc(
    result.metadata.width * result.metadata.height * 3
  );
  for (let x = 0; x < result.metadata.width; x++) {
    for (let y = 0; y < result.metadata.height; y++) {
      if (mapData[x] && mapData[x][y]) {
        const tile = mapData[x][y][0];
        if (tile) {
          const index = spriteRevIndex.data[tile.sprite];
          if (!index) {
            return onError(
              `Invalid sprite at (${x},${y}): ${chalk.green(
                result.metadata.spriteSheet
              )}:${chalk.blue(tile.sprite)}`
            );
          }
          encodeMapTile(mapBuffer, (x + y * result.metadata.width) * 3, {
            index,
            triggerId: tile.triggerId,
            walkable: tile.walkable,
            spatialHash: tile.spatialHash,
            animated: tile.animated,
          });
        }
      }
    }
  }

  const mapPath = path.join(wwwPath, `${map}.png`);

  await sharp(mapBuffer, {
    raw: {
      width: result.metadata.width,
      height: result.metadata.height,
      channels: 3,
    },
  })
    .png()
    .toFile(mapPath)
    .then(() => {
      log(`Completed ${chalk.green(map)}.`);
    })
    .catch((err) => {
      onError(`Failed to build ${map}: ${err.toString()}`);
    });

  const mapHash = await getFileHash(mapPath);

  await fs.writeFile(
    path.join(mapSrcPath, `${map}.ts`),
    `
    import SpriteSheet from "../sprites/${result.metadata.spriteSheet}";
    const Map = {...${JSON.stringify({
      ...result.metadata,
      url: `/maps/${map}.png?v=${mapHash}`,
    })}, spriteSheet: SpriteSheet,
    };
export default Map;`
  );
}
