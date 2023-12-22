import chalk from "chalk";
import { EventEmitter } from "events";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";

import { ensurePath, getFileHash } from "../file-utils";
import { BuildContext, BuildPlugin, BuildWatchEvent } from "../plugin";

export default class HtmlPlugin extends EventEmitter implements BuildPlugin {
  depends = ["esbuild", "static", "editor-tailwindcss"];

  #deps: Set<string> = new Set();

  constructor() {
    super();
  }

  async init(ctx: BuildContext): Promise<boolean> {
    await ensurePath(ctx.outputRoot);
    return true;
  }

  async clean(ctx: BuildContext): Promise<void> {
    try {
      await fs.rm(path.join(ctx.outputRoot, "index.html"));
    } catch (e) {}
  }

  async build(ctx: BuildContext, incremental: boolean): Promise<void> {
    await this.#processHtml(ctx);
  }

  async watch(
    ctx: BuildContext,
    subscribe: (
      path: string,
      callback: (err: Error | null, events: Array<BuildWatchEvent>) => void
    ) => Promise<any>
  ): Promise<void> {
    await subscribe(ctx.outputRoot, async (_err, events) => {
      let reprocess = false;
      for (const e of events) {
        reprocess = reprocess || this.#deps.has(e.path);
      }
      if (reprocess) {
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

    ctx.log(`Building ${chalk.green("index.html")}...`);
    await fs.writeFile(path.join(ctx.outputRoot, "index.html"), html);
  }

  async #includeFile(
    ctx: BuildContext,
    filePath: string,
    force: boolean,
    callback: (url: string) => string
  ): Promise<string> {
    const file = path.join(ctx.outputRoot, filePath);
    const exists = existsSync(path.join(ctx.outputRoot, filePath));
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
