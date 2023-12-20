import { EventEmitter } from "events";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";

import { getFileHash } from "../common-utils";
import { BuildContext, BuildPlugin, BuildWatchEvent } from "../plugin";

export default class StaticPlugin extends EventEmitter implements BuildPlugin {
  getName(): string {
    return "Static";
  }
  async init(ctx: BuildContext): Promise<boolean> {
    return existsSync(path.join(ctx.assetRoot, "static"));
  }

  async clean(ctx: BuildContext): Promise<void> {
    try {
      const staticPath = path.join(ctx.outputRoot, "static");
      const st = await fs.stat(staticPath);
      await fs.rm(
        staticPath,
        !st.isSymbolicLink()
          ? {
              recursive: true,
              force: true,
            }
          : undefined
      );
    } catch (e) {}
  }

  async build(ctx: BuildContext, incremental: boolean): Promise<void> {
    if (ctx.production) {
      ctx.log(`Copying static resources...`);
      await fs.cp(
        path.join(ctx.assetRoot, "static"),
        path.join(ctx.outputRoot, "static")
      );
    } else {
      // in development builds, just symlink the static folder
      // as it's faster
      const st = await fs.stat(path.join(ctx.outputRoot, "static"));
      if (!st) {
        ctx.log(`Symlinking static resources...`);
        await fs.symlink(
          path.join(ctx.assetRoot, "static"),
          path.join(ctx.outputRoot, "static")
        );
      }
    }
  }

  async watch(
    ctx: BuildContext,
    subscribe: (
      path: string,
      callback: (err: Error | null, events: Array<BuildWatchEvent>) => void
    ) => Promise<any>
  ): Promise<void> {
    const staticPath = path.join(ctx.assetRoot, "static");
    await subscribe(staticPath, async (_err, events) => {
      const resources: { [key: string]: string } = {};
      for (const e of events) {
        const basePath = e.path.substring(staticPath.length);
        switch (e.type) {
          case "create":
          case "update":
            {
              if (ctx.production) {
                await fs.cp(
                  e.path,
                  path.join(ctx.outputRoot, "static", basePath)
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
                await fs.rm(path.join(ctx.outputRoot, "static", basePath));
              } catch (e) {}
            }
        }
      }
      this.emit("event", {
        type: "RELOAD_STATIC",
        resources,
      });
    });
  }
}
