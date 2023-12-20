import chalk from "chalk";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

import { EditorConnection, EditorServerContext } from "@pixelheart/api";
import { loadJson } from "@pixelheart/file-utils";
import { MapTileSource, encodeMapTile } from "@pixelheart/map";
import { MapMetadata, loadMapMetadata } from "@pixelheart/map-loader";

import { EditorActions, EditorEvents } from "../client";

interface WorkingMapData {
  lastAccess: number;
  image: {
    width: number;
    height: number;
    channels: sharp.Channels;
    buffer: Buffer;
    path: string;
  };
  src: {
    data: { [x: string]: { [y: string]: { [z: string]: MapTileSource } } };
    meta: MapMetadata;
    path: string;
  };
}

const log = (message: string) => {
  console.log(chalk.dim("[Editor]"), message);
};

const logError = (message: string) => {
  console.log(chalk.dim("[Editor]"), chalk.red(message));
};

export default class Server {
  #mapUpdateInterval: NodeJS.Timeout | undefined;
  #mapCache: Map<string, WorkingMapData>;
  #pendingMapActions: Map<string, Array<EditorActions>>;
  #connection: EditorConnection<EditorEvents, EditorActions>;
  #context: EditorServerContext;

  constructor(
    context: EditorServerContext,
    connection: EditorConnection<EditorEvents, EditorActions>
  ) {
    this.#context = context;
    this.#connection = connection;
    this.#mapCache = new Map<string, WorkingMapData>();
    this.#pendingMapActions = new Map<string, Array<EditorActions>>();
    this.#mapUpdateInterval = setInterval(
      () => this.#flushMapChanges(),
      5000
    );
    this.#connection.onEvent((a) => {
      switch (a.type) {
        case "TILE_CHANGE":
          {
            let actions = this.#pendingMapActions.get(a.map);
            if (!actions) {
              actions = [];
              this.#pendingMapActions.set(a.map, actions);
            }
            actions.push(a);
          }
          break;
        case "RESTART":
          {
            clearInterval(this.#mapUpdateInterval);
            this.#flushMapChanges().then(() => {
              process.exit(0);
            });
          }
          break;
      }
    });
    log("Running");
  }

  async #flushMapChanges() {
    const updated = new Map<string, WorkingMapData>();
    // copy so that we can safely start accumulating
    // new changes while we're processing
    const actionsToApply = [...this.#pendingMapActions];
    this.#pendingMapActions.clear();

    for (const [map, actions] of actionsToApply) {
      const existing = await this.#getMap(map);
      if (!existing) {
        logError(`Failed to load map ${map}`);
        continue;
      }

      const revIndex = await loadJson(
        path.join(
          this.#context.generatedSrcRoot,
          "sprites",
          `${existing.src.meta.spriteSheet}.json`
        )
      );
      if (!revIndex.ok) {
        logError(
          `Failed to load sprite sheet ${existing.src.meta.spriteSheet} for map ${map}`
        );
        continue;
      }

      updated.set(map, existing);

      for (const a of actions) {
        if (a.type !== "TILE_CHANGE") {
          continue;
        }
        if (!existing.src.data[a.x]) {
          existing.src.data[a.x] = {};
        }
        if (!existing.src.data[a.x][a.y]) {
          existing.src.data[a.x][a.y] = {};
        }
        if (a.value.sprite) {
          existing.src.data[a.x][a.y][0] = a.value;
        } else {
          delete existing.src.data[a.x][a.y][0];
        }
        encodeMapTile(
          existing.image.buffer,
          (a.x + a.y * existing.image.width!) * existing.image.channels!,
          { ...a.value, index: revIndex.data[a.value.sprite] }
        );
      }
    }

    for (const [map, u] of updated) {
      try {
        await sharp(u.image.buffer, {
          raw: {
            width: u.image.width!,
            height: u.image.height!,
            channels: u.image.channels!,
          },
        })
          .png()
          .toFile(u.image.path);
        await fs.writeFile(u.src.path, JSON.stringify(u.src.data, null, 2));
        log(`Saved map ${chalk.green(map)}`);
      } catch (err) {
        logError(`Failed to update map ${map} - ${err}`);
      }
    }

    const maps = [...this.#mapCache];
    for (const [key, value] of maps) {
      // clear out maps from memory that haven't been accessed in 10 seconds
      if (Date.now() - value.lastAccess > 10000) this.#mapCache.delete(key);
    }
  }

  async #getMap(map: string): Promise<WorkingMapData | null> {
    let existing = this.#mapCache.get(map);
    if (!existing) {
      const imagePath = path.join(
        this.#context.outputRoot,
        "maps",
        `${map}.png`
      );
      const mapsPath = path.join(this.#context.assetsRoot, "maps");
      const image = sharp(imagePath);
      const metadata = await image.metadata();
      const result = await loadMapMetadata(mapsPath, map);
      if (!result.ok) {
        return null;
      }
      const mapDataPath = path.join(mapsPath, map, "data.json");
      const mapData = await loadJson(mapDataPath);
      if (!mapData.ok) {
        return null;
      }
      existing = {
        lastAccess: Date.now(),
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

      this.#mapCache.set(map, existing);
      log(`Loaded map ${chalk.green(map)}`);
    }
    if (existing) {
      existing.lastAccess = Date.now();
    }
    return existing;
  }
}
