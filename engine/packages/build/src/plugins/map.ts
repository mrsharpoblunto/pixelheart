import chalk from "chalk";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

import { MapTileSource, encodeMapTile } from "@pixelheart/client";
import { loadJson, loadMapMetadata } from "@pixelheart/server";

import { ensurePath, getFileHash } from "../file-utils.js";
import { BuildContext, BuildPlugin, BuildWatchEvent } from "../plugin.js";

export default class MapPlugin implements BuildPlugin {
  depends = ["sprite"];

  #getPaths(ctx: BuildContext) {
    return {
      maps: path.join(ctx.gameAssetPath, "maps"),
      output: path.join(ctx.gameOutputPath, "maps"),
      mapSrc: path.join(ctx.gameClientPath, "maps"),
      spriteSrc: path.join(ctx.gameClientPath, "sprites"),
    };
  }

  async init(ctx: BuildContext): Promise<boolean> {
    const paths = this.#getPaths(ctx);
    if (existsSync(paths.maps)) {
      await ensurePath(paths.output);
      await ensurePath(paths.mapSrc);
      return true;
    } else {
      return false;
    }
  }

  async clean(ctx: BuildContext) {
    const paths = this.#getPaths(ctx);
    try {
      await Promise.all([
        fs.rm(paths.maps, {
          recursive: true,
          force: true,
        }),
        fs.rm(paths.mapSrc, {
          recursive: true,
          force: true,
        }),
      ]);
    } catch (e) { }
  }

  async build(ctx: BuildContext) {
    const paths = this.#getPaths(ctx);

    // on first run, check if any maps are missing or older
    // than the source and build them.
    const sourceMaps = await fs.readdir(paths.maps);
    const destMaps = !ctx.clean ? await fs.readdir(paths.output) : [];
    for (const src of sourceMaps) {
      const srcStat = await fs.stat(path.join(paths.maps, src));
      if (srcStat.isFile()) {
        continue;
      }
      const dest = destMaps.find((d) => d === `${src}.png`);
      if (
        // doesn't exist
        !dest ||
        // or is older than the source
        srcStat.mtimeMs >
        (await fs.stat(path.join(paths.output, dest))).mtimeMs
      ) {
        await this.#processMap(ctx, src);
      }
    }
  }

  async watch(
    ctx: BuildContext,
    subscribe: (
      path: string,
      cb: (err: Error | null, events: Array<BuildWatchEvent>) => any
    ) => Promise<void>
  ) {
    const paths = this.#getPaths(ctx);
    await subscribe(paths.spriteSrc, async (_err, events) => {
      await this.#processMapSpriteEvents(ctx, events);
    });
    await subscribe(path.join(paths.maps), async (_err, events) => {
      await this.#processMapEvents(ctx, events);
    });
  }

  async #processMapSpriteEvents(
    ctx: BuildContext,
    events: Array<BuildWatchEvent>
  ) {
    const paths = this.#getPaths(ctx);
    // if a sprite rev index.json changes, rebuild any maps
    // which have a metadata.sprite field that matches the
    // changed file
    for (let e of events) {
      if (path.extname(e.path) === ".json") {
        const sprite = path.basename(e.path, ".json");

        const maps = await fs.readdir(paths.maps);
        for (const map of maps) {
          const srcStat = await fs.stat(path.join(paths.maps, map));
          if (srcStat.isFile()) {
            continue;
          }
          const result = await loadMapMetadata(paths.maps, map);
          if (result.ok && result.metadata.spriteSheet === sprite) {
            await this.#processMap(ctx, map);
            ctx.emit({ type: "RELOAD_MAP", map });
          }
        }
      }
    }
  }

  async #processMapEvents(ctx: BuildContext, events: Array<BuildWatchEvent>) {
    const paths = this.#getPaths(ctx);

    const newOrModified = new Set<string>();
    const deleted = [];
    for (let e of events) {
      const components = e.path.substring(paths.maps.length + 1).split("/");
      switch (e.type) {
        case "create":
        case "update":
          if (components.length === 1 || components[1] === "metadata.json") {
            newOrModified.add(components[0]);
          }
          break;

        case "delete":
          {
            if (components.length === 1) {
              deleted.push(components[0]);
            }
          }
          break;
      }
    }

    for (const d of deleted) {
      await fs.rm(path.join(paths.mapSrc, `${d}.ts`));
      await fs.rm(path.join(paths.output, `${d}.png`));
    }

    for (const nom of newOrModified) {
      await this.#processMap(ctx, nom);
      ctx.emit({ type: "RELOAD_MAP", map: nom });
    }
  }

  async #processMap(ctx: BuildContext, map: string): Promise<void> {
    ctx.log(`Building map ${chalk.green(map)}...`);

    const paths = this.#getPaths(ctx);
    const result = await loadMapMetadata(paths.maps, map);
    if (!result.ok) {
      if (result.errors.length > 0) {
        ctx.error(
          `Invalid map metadata: ${result.errors
            .map((e) => e.message)
            .join(", ")}`
        );
      } else {
        ctx.error(`Invalid map metadata: invalid JSON`);
      }
      return;
    }

    ctx.log(
      `Generating ${result.metadata.width}x${result.metadata.height
      } map using sprite sheet ${chalk.green(result.metadata.spriteSheet)}...`
    );

    const dataPath = path.join(paths.maps, map, "data.json");
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
      path.join(paths.spriteSrc, `${result.metadata.spriteSheet}.json`)
    );

    if (!spriteRevIndex.ok) {
      return ctx.error(
        `Invalid sprite sheet: ${result.metadata.spriteSheet}`
      );
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
              return ctx.error(
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

    const mapPath = path.join(paths.output, `${map}.png`);

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
        ctx.log(`Completed ${chalk.green(map)}.`);
      })
      .catch((err) => {
        ctx.error(`Failed to build ${map}: ${err.toString()}`);
      });

    const mapHash = await getFileHash(mapPath);

    await fs.writeFile(
      path.join(paths.mapSrc, `${map}.ts`),
      `
    import SpriteSheet from "../sprites/${result.metadata.spriteSheet}.js";
    const Map = {...${JSON.stringify({
        ...result.metadata,
        url: `/maps/${map}.png?v=${mapHash}`,
      })}, spriteSheet: SpriteSheet,
    };
export default Map;`
    );
  }
}
