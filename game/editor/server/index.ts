import chalk from "chalk";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import url from "url";

import { MapTile, MapTileSource, encodeMapTile } from "@pixelheart/client";
import {
  EditorServerConnection,
  MapMetadata,
  loadJson,
  loadMapMetadata,
} from "@pixelheart/server";

import { EditMapTilesAction, EditMapTilesEvent, EditorActions, EditorEvents } from "../client/index.js";

interface WorkingMapData {
  lastAccess: number;
  lastWrite: number;
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

const dirname = path.dirname(url.fileURLToPath(import.meta.url));

const CACHE_INTERVAL = 30000;

class EditorServer {
  #mapUpdateInterval: NodeJS.Timeout | undefined;
  #mapCache: Map<string, WorkingMapData>;
  // editor server sends events and receives actions, the opposite to the
  // client
  #connection: EditorServerConnection<EditorEvents, EditorActions>;
  #outputRoot: string | null;

  constructor() {
    this.#outputRoot = null;
    this.#outputRoot = null;
    this.#connection = new EditorServerConnection();
    this.#mapCache = new Map<string, WorkingMapData>();
    this.#mapUpdateInterval = setInterval(() => this.#savePendingMapChanges(), 1000);
    this.#connection.listen(async (a) => {
      switch (a.type) {
        case "INIT":
          this.#outputRoot = a.outputRoot;
          break;
        case "RESTART":
          {
            clearInterval(this.#mapUpdateInterval);
            await this.#savePendingMapChanges();
            process.exit(0);
          }
        case "EDIT_MAP_TILES":
          {
            const event = await this.#applyMapTileChanges(a);
            if (event) {
              this.#connection.send(event);
            }
          }
          break;
      }
    });
    console.log("Running");
  }

  async #savePendingMapChanges() {
    const maps = [...this.#mapCache];
    for (const [key, value] of maps) {
      if (Date.now() - value.lastAccess > CACHE_INTERVAL) {
        this.#mapCache.delete(key);
      }
    }

    for (const [key, value] of maps) {
      if (value.lastWrite <= value.lastAccess) {
        value.lastWrite = Date.now();
        try {
          await sharp(value.image.buffer, {
            raw: {
              width: value.image.width!,
              height: value.image.height!,
              channels: value.image.channels!,
            },
          })
            .png()
            .toFile(value.image.path);
          await fs.writeFile(value.src.path, JSON.stringify(value.src.data, null, 2));
          console.log(`Saved map ${chalk.green(key)}`);
        } catch (err) {
          console.error(`Failed to update map ${key} - ${err}`);
        }
      }
    }
  }

  async #applyMapTileChanges(action: EditMapTilesAction): Promise<EditMapTilesEvent | null> {
    const event: EditMapTilesEvent = {
      map: action.map,
      tiles: [],
      type: "EDIT_MAP_TILES_APPLY",
    };

    const map = await this.#getMap(action.map);
    if (!map) {
      console.error(`Failed to load map ${action.map}`);
      return null;
    }

    const revIndex = await loadJson(
      path.join(
        dirname,
        "..",
        "..",
        "client",
        "sprites",
        `${map.src.meta.spriteSheet}.json`
      )
    );
    if (!revIndex.ok) {
      console.error(
        `Failed to load sprite sheet ${map.src.meta.spriteSheet} for map ${action.map}`
      );
      return null;
    }

    for (const change of action.tiles) {
      if (!map.src.data[change.x]) {
        map.src.data[change.x] = {};
      }
      if (!map.src.data[change.x][change.y]) {
        map.src.data[change.x][change.y] = {};
      }

      const src: MapTileSource = {
        ...(map.src.data[change.x][change.y][0] || {
          // TODO deal with map defaults....
          // should be loaded from the map folder along with tile groupings...
          walkable: change.value.sprite !== "",
          spatialHash: change.value.sprite !== "",
          animated: false,
          triggerId: 0,
        }),
        ...change.value,
      };

      const { sprite: _, ...srcWithoutSprite } = src;

      const value: MapTile = {
        ...srcWithoutSprite,
        index: change.value.sprite ? revIndex.data[change.value.sprite] : 0,
      };

      event.tiles.push({
        x: change.x,
        y: change.y,
        value
      });

      if (value.index) {
        map.src.data[change.x][change.y][0] = src;
      } else if (change.value.sprite === "") {
        delete map.src.data[change.x][change.y][0];
      }

      encodeMapTile(
        map.image.buffer,
        (change.x + change.y * map.image.width!) * map.image.channels!,
        value,
      );
    }
    return event;
  }

  async #getMap(map: string): Promise<WorkingMapData | null> {
    let existing = this.#mapCache.get(map);
    if (!existing) {
      if (!this.#outputRoot) {
        return null;
      }

      const imagePath = path.join(this.#outputRoot, "maps", `${map}.png`);
      const mapsPath = path.join(dirname, "..", "..", "assets", "maps");
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
        lastWrite: 0,
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
      console.log(`Loaded map ${chalk.green(map)}`);
    }
    if (existing) {
      existing.lastAccess = Date.now();
    }
    return existing;
  }
}

new EditorServer();
