import autoprefixer from "autoprefixer";
import chalk from "chalk";
import { EventEmitter } from "events";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

import { getStringHash } from "../common-utils";
import { BuildContext, BuildPlugin, BuildWatchEvent } from "../plugin";

export default class EditorCssPlugin extends EventEmitter implements BuildPlugin {
  getName(): string {
    return "Editor CSS";
  }
  async init(ctx: BuildContext): Promise<boolean> {
    return this.#shouldWatch(ctx) && !ctx.production;
  }

  async clean(ctx: BuildContext): Promise<void> {
    try {
      await fs.rm(path.join(ctx.outputRoot, "editor.css"));
    } catch (e) {}
  }
  async build(ctx: BuildContext, incremental: boolean): Promise<void> {
    await this.#processCss(ctx);
  }

  async watch(
    ctx: BuildContext,
    subscribe: (
      path: string,
      callback: (err: Error | null, events: Array<BuildWatchEvent>) => void
    ) => Promise<any>
  ): Promise<void> {
    await subscribe(
      path.join(ctx.gameRoot, "editor", "client"),
      async (_err, _events) => {
        const cssHash = await this.#processCss(ctx);
        this.emit("event", {
          type: "RELOAD_STATIC",
          resources: {
            "/editor.css": `/editor.css?v=${cssHash}`,
          },
        });
      }
    );
  }

  async #processCss(ctx: BuildContext) {
    ctx.log(`Building ${chalk.green("editor.css")}`);

    const tailwindConfig = this.#getTailwindConfig(ctx);
    const result = await postcss([
      autoprefixer,
      tailwindcss({
        ...tailwindConfig,
        content: tailwindConfig?.content.map((c: any) =>
          path.join(ctx.gameRoot, "editor", "client", c)
        ),
      }),
    ]).process(
      `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
      { from: undefined, to: "www/editor.css" }
    );
    await fs.writeFile(path.join(ctx.outputRoot, "editor.css"), result.css);
    return getStringHash(result.css);
  }

  #shouldWatch(ctx: BuildContext): boolean {
    const config = this.#getTailwindConfig(ctx);
    return config.content;
  }

  #getTailwindConfig(ctx: BuildContext): any {
    const editorTailwindFile = path.join(
      path.join(ctx.gameRoot, "editor", "client"),
      "tailwind.config.js"
    );
    return existsSync(editorTailwindFile) ? require(editorTailwindFile) : null;
  }
}
