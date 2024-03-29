import chalk from "chalk";
import * as esbuild from "esbuild";
import fs from "fs/promises";
import path from "path";

import { BuildContext, BuildPlugin, BuildWatchEvent } from "../plugin.js";

export default class ESBuildPlugin implements BuildPlugin {
  depends = ["sprite", "map", "shader"];

  #esbuild: esbuild.BuildContext<esbuild.BuildOptions> | null = null;

  async init(ctx: BuildContext): Promise<boolean> {
    return ctx.build;
  }

  async clean(ctx: BuildContext): Promise<void> {
    try {
      await fs.rm(path.join(ctx.gameOutputPath, "js"), {
        recursive: true,
        force: true,
      });
    } catch (e) { }
  }

  async build(ctx: BuildContext): Promise<void> {
    if (ctx.watch) {
      this.#esbuild = await esbuild.context(this.#getConfig(ctx));
    } else {
      try {
        await esbuild.build(this.#getConfig(ctx));
      } catch (e: any) {
        ctx.error("esbuild", "Build failed");
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
    if (!this.#esbuild) {
      return;
    }
    if (typeof ctx.watch !== "boolean") {
      const { port } = await this.#esbuild.serve({
        port: ctx.watch.port,
        servedir: ctx.gameOutputPath,
        onRequest: (args: any) => {
          ctx.log("esbuild",
            `[${args.method}] ${args.path} ${(args.status >= 200 &&
              args.status < 400
              ? chalk.green
              : chalk.red)(args.status)}`
          );
        },
      });
      ctx.log("esbuild", `Listening on ${port}`);
    }
    await this.#esbuild.watch({});
  }

  #getConfig(ctx: BuildContext): esbuild.BuildOptions {
    return {
      minifyIdentifiers: ctx.production,
      minifySyntax: ctx.production,
      minifyWhitespace: ctx.production,
      bundle: true,
      target: "esnext",
      outdir: path.join(ctx.gameOutputPath, "js"),
      logLevel: ctx.watch ? "silent" : "info",
      define: {
        ["process.env.NODE_ENV"]: `"${ctx.production ? "production" : "development"
          }"`,
        ["process.env.GAME_CLIENT"]: `"${path.join(
          ctx.gameClientPath,
          "index.ts"
        )}"`,
        ["process.env.GAME_EDITOR"]: `"${path.join(
          ctx.gameEditorClientPath,
          "index.ts"
        )}"`,
      },
      format: "esm",
      entryNames: "[name]",
      entryPoints: ["@pixelheart/client/entrypoint"],
      platform: "browser",
      sourcemap: true,
    };
  }
}
