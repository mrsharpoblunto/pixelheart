import chalk from "chalk";
import { EventEmitter } from "events";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";

import { ensurePath, getFileHash } from "../file-utils.js";
import { BuildContext, BuildPlugin, BuildWatchEvent } from "../plugin.js";

export default class HtmlPlugin implements BuildPlugin {
  depends = ["esbuild", "static", "editor-tailwindcss"];

  #deps: Set<string> = new Set();

  async init(ctx: BuildContext): Promise<boolean> {
    await ensurePath(ctx.gameOutputPath);
    return true;
  }

  async clean(ctx: BuildContext): Promise<void> {
    try {
      await fs.rm(path.join(ctx.gameOutputPath, "index.html"));
    } catch (e) { }
  }

  async build(ctx: BuildContext): Promise<void> {
    ctx.log("html", `Building ${chalk.green("index.html")}...`);
    await this.#processHtml(ctx);
  }

  async watch(
    ctx: BuildContext,
    subscribe: (
      path: string,
      callback: (err: Error | null, events: Array<BuildWatchEvent>) => void
    ) => Promise<any>
  ): Promise<void> {
    await subscribe(ctx.gameOutputPath, async (_err, events) => {
      let reprocess = false;
      for (const e of events) {
        reprocess = reprocess || this.#deps.has(e.path);
      }
      if (reprocess) {
        ctx.log("html", `Dependencies changed, rebuilding ${chalk.green("index.html")}...`);
        await this.#processHtml(ctx);
      }
    });
  }

  async #processHtml(ctx: BuildContext): Promise<void> {
    this.#deps = new Set();
    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="data:,">
    <title>PixelHeart</title>
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        position: fixed;
      }
      #root {
        overflow: hidden;
        width: 100vw;
        height: 100vh;
        display: flex;
      }
    </style>
    ${await this.#includeFile(
      ctx,
      "/editor.css",
      false,
      (e) => `<link rel="stylesheet" href="${e}">`
    )}
  </head>
  <body>
    <div id="root"></div>
    ${await this.#includeFile(
      ctx,
      "/js/entrypoint.js",
      true,
      (e) => `<script src="${e}" type="module"></script>`
    )}
  </body>
</html>`;

    await fs.writeFile(path.join(ctx.gameOutputPath, "index.html"), html);
  }

  async #includeFile(
    ctx: BuildContext,
    filePath: string,
    force: boolean,
    callback: (url: string) => string
  ): Promise<string> {
    const file = path.join(ctx.gameOutputPath, filePath);
    const exists = existsSync(path.join(ctx.gameOutputPath, filePath));
    if (exists || force) {
      this.#deps.add(file);
      if (exists) {
        const fileHash = await getFileHash(file);
        return callback(`${filePath}?v=${fileHash}`);
      } else {
        return callback(filePath);
      }
    }
    return "";
  }
}
