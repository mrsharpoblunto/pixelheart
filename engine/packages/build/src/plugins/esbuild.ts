import chalk from "chalk";
import * as esbuild from "esbuild";
import fs from "fs/promises";
import path from "path";

import { BuildContext, BuildPlugin, BuildWatchEvent } from "../plugin.js";

export default class ESBuildPlugin implements BuildPlugin {
  depends = ["sprite", "map", "shader"];

  #ctx: esbuild.BuildContext<esbuild.BuildOptions> | null = null;

  async init(ctx: BuildContext): Promise<boolean> {
    return true;
  }

  async clean(ctx: BuildContext): Promise<void> {
    try {
      await fs.rm(path.join(ctx.outputRoot, "js"), {
        recursive: true,
        force: true,
      });
    } catch (e) {}
  }

  async build(ctx: BuildContext, incremental: boolean): Promise<void> {
    if (ctx.watch) {
      this.#ctx = await esbuild.context(this.#getConfig(ctx));
    } else {
      try {
        await esbuild.build(this.#getConfig(ctx));
      } catch (e: any) {
        ctx.onError("Build failed");
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
    if (!this.#ctx) {
      return;
    }
    const { port } = await this.#ctx.serve({
      port: ctx.port,
      servedir: ctx.outputRoot,
      onRequest: (args: any) => {
        ctx.log(
          `[${args.method}] ${args.path} ${(args.status >= 200 &&
            args.status < 400
            ? chalk.green
            : chalk.red)(args.status)}`
        );
      },
    });
    await this.#ctx.watch({});
    ctx.log(`Listening on ${port}`);
  }

  #getConfig(ctx: BuildContext): esbuild.BuildOptions {
    return {
      minifyIdentifiers: ctx.production,
      minifySyntax: ctx.production,
      minifyWhitespace: ctx.production,
      bundle: true,
      target: "esnext",
      outdir: path.join(ctx.outputRoot, "js"),
      logLevel: ctx.watch ? "silent" : "info",
      define: {
        ["process.env.NODE_ENV"]: `"${
          ctx.production ? "production" : "development"
        }"`,
        ["process.env.GAME_CLIENT"]: `"${path.join(
          ctx.gameRoot,
          "client",
          "index.ts"
        )}"`,
        ["process.env.GAME_EDITOR"]: `"${path.join(
          ctx.gameRoot,
          "editor",
          "client",
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
