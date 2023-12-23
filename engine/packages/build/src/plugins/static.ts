import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";

import { ensurePath, getFileHash } from "../file-utils.js";
import { BuildContext, BuildPlugin, BuildWatchEvent } from "../plugin.js";

export default class StaticPlugin implements BuildPlugin {
  depends = [];

  #getPaths(ctx: BuildContext) {
    return {
      static: path.join(ctx.gameAssetPath, "static"),
      output: path.join(ctx.gameOutputPath, "static"),
    };
  }

  async init(ctx: BuildContext): Promise<boolean> {
    const paths = this.#getPaths(ctx);
    if (existsSync(paths.static)) {
      await ensurePath(paths.output);
      return true;
    }
    return false;
  }

  async clean(ctx: BuildContext): Promise<void> {
    try {
      const paths = this.#getPaths(ctx);
      const st = await fs.stat(paths.static);
      await fs.rm(
        paths.static,
        !st.isSymbolicLink()
          ? {
            recursive: true,
            force: true,
          }
          : undefined
      );
    } catch (e) { }
  }

  async build(ctx: BuildContext): Promise<void> {
    const paths = this.#getPaths(ctx);
    if (existsSync(paths.static)) {
      const st = await fs.lstat(paths.output);
      if (st.isSymbolicLink() || !ctx.production) {
        await fs.rm(
          paths.output,
          { recursive: true, force: true }
        );
      }
    }

    if (ctx.production) {
      ctx.log(`Copying static resources...`);
      await fs.cp(paths.static, paths.output, {
        recursive: true,
      });
    } else {
      // in development builds, just symlink the static folder
      // as it's faster
      ctx.log(`Symlinking static resources...`);
      await fs.symlink(paths.static, paths.output);
    }
  }

  async watch(
    ctx: BuildContext,
    subscribe: (
      path: string,
      callback: (err: Error | null, events: Array<BuildWatchEvent>) => void
    ) => Promise<any>
  ): Promise<void> {
    const paths = this.#getPaths(ctx);
    await subscribe(paths.static, async (_err, events) => {
      const resources: { [key: string]: string } = {};
      for (const e of events) {
        const basePath = e.path.substring(paths.static.length);
        switch (e.type) {
          case "create":
          case "update":
            {
              if (ctx.production) {
                await fs.cp(
                  e.path,
                  path.join(paths.output, basePath)
                );
              }
              resources[basePath] = `/static${basePath}?v=${await getFileHash(
                e.path
              )}`;
            }
            break;

          case "delete":
            if (ctx.production) {
              try {
                await fs.rm(path.join(paths.output, basePath));
              } catch (e) { }
            }
        }
      }
      ctx.emit({
        type: "RELOAD_STATIC",
        resources,
      });
    });
  }
}
