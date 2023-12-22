import autoprefixer from "autoprefixer";
import chalk from "chalk";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

import { ensurePath, getStringHash } from "../file-utils.js";
import { BuildContext, BuildPlugin, BuildWatchEvent } from "../plugin.js";

export default class EditorCssPlugin
  implements BuildPlugin
{
  depends = [];

  async init(ctx: BuildContext): Promise<boolean> {
    if ((await this.#shouldWatch(ctx)) && !ctx.production) {
      await ensurePath(ctx.outputRoot);
      return true;
    }
    return false;
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
        ctx.event({
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

    const tailwindConfig = await this.#getTailwindConfig(ctx);
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
      { from: undefined, to: "editor.css" }
    );
    await fs.writeFile(path.join(ctx.outputRoot, "editor.css"), result.css);
    return getStringHash(result.css);
  }

  async #shouldWatch(ctx: BuildContext): Promise<boolean> {
    const config = await this.#getTailwindConfig(ctx);
    return config.content;
  }

  async #getTailwindConfig(ctx: BuildContext): Promise<any> {
    const editorTailwindFile = path.join(
      path.join(ctx.gameRoot, "editor", "client"),
      "tailwind.config.cjs"
    );
    return existsSync(editorTailwindFile)
      ? (await import(editorTailwindFile)).default
      : null;
  }
}
