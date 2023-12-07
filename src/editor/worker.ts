import { parentPort } from "worker_threads";
import { EditorAction } from "../shared/editor-actions";
import { encodeMapTile, MapTileSource } from "../shared/map-format";
import {
  wwwPath as mapsWwwPath,
  loadMapMetadata,
  mapsPath,
  MapMetadata,
} from "../../build/map-utils";
import { spriteSrcPath } from "../../build/sprite-utils";
import path from "path";
import sharp from "sharp";
import chalk from "chalk";
import fs from "fs/promises";

interface WorkingMapData {
  version: number;
  image: {
    width: number;
    height: number;
    channels: sharp.Channels;
    buffer: Buffer;
    path: string;
  };
  src: {
    data: Array<Array<Array<MapTileSource | null>>>;
    meta: MapMetadata;
    path: string;
  };
}

const workingMaps = new Map<string, WorkingMapData>();

const log = (message: string) => {
  console.log(chalk.dim("[Editor]"), message);
};

const logError = (message: string) => {
  console.log(chalk.dim("[Editor]"), chalk.red(message));
};

if (parentPort) {
  log("Running.");

  setInterval(() => {
    const maps = [...workingMaps];
    for (const [key, value] of maps) {
      const version = value.version;
      sharp(value.image.buffer, {
        raw: {
          width: value.image.width!,
          height: value.image.height!,
          channels: value.image.channels!,
        },
      })
        .png()
        .toFile(value.image.path)
        .then(() => {
          log(`Saved updated image to ${value.image.path}`);
          return fs.writeFile(value.src.path, JSON.stringify(value.src.data));
        })
        .then(() => {
          log(`Saved map src data to ${value.src.path}`);
          if (value.version === version) {
            // there was no modification between when the saving started and ended
            // otherwise we keep this modified value in memory rather than load
            // an out of date version that doesn't have the in-memory changes included
            workingMaps.delete(key);
          }
        })
        .catch((err) => {
          logError(`Failed to update map ${key} - ${err.toString()}`);
        });
    }
  }, 2000);

  parentPort.on("message", async (message: any) => {
    // process the editor action
    let actionCount = 1;
    let previousAction = null;
    for (let a of message.actions as Array<EditorAction>) {
      if (previousAction === a.type) {
        actionCount++;
      } else {
        if (previousAction !== null) {
          log(`Processing ${actionCount} ${chalk.green(a.type)} action(s)`);
        }
        previousAction = a.type;
        actionCount = 1;
      }

      switch (a.type) {
        case "TILE_CHANGE":
          {
            const existing = await getMap(a.map);
            if (!existing) {
              break;
            }

            const revIndex = await loadJson(
              path.join(spriteSrcPath, `${existing.src.meta.spriteSheet}.json`)
            );
            if (!revIndex.ok) {
              break;
            }

            existing.src.data[a.x][a.y][0] = a.value.sprite ? a.value : null;
            encodeMapTile(
              existing.image.buffer,
              (a.x + a.y * existing.image.width!) * existing.image.channels!,
              { ...a.value, index: revIndex.data[a.value.sprite] }
            );
          }
          break;
        case "RESTART":
          process.exit(0);
        default:
          throw new Error("Unknown Editor action");
      }
    }
    if (previousAction) {
      log(`Processing ${actionCount} ${chalk.green(previousAction)} action(s)`);
    }

    if (message.requestId) {
      parentPort!.postMessage({
        requestId: message.requestId,
        response: {},
      });
    }
  });
}

async function getMap(map: string): Promise<WorkingMapData | null> {
  let existing = workingMaps.get(map);
  if (!existing) {
    const imagePath = path.join(mapsWwwPath, `${map}.png`);
    const image = sharp(imagePath);
    const metadata = await image.metadata();
    const result = await loadMapMetadata(map);
    if (!result.ok) {
      return null;
    }
    const mapDataPath = path.join(mapsPath, map, "data.json");
    const mapData = await loadJson(mapDataPath);
    if (!mapData.ok) {
      return null;
    }
    existing = {
      version: 0,
      image: {
        width: metadata.width!,
        height: metadata.height!,
        channels: metadata.channels!,
        buffer: await image.raw().toBuffer(),
        path: imagePath,
      },
      src: {
        data: mapData.data,
        meta: result.metadata,
        path: mapDataPath,
      },
    };

    workingMaps.set(map, existing);
  }
  if (existing) {
    existing.version++;
  }
  return existing;
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
