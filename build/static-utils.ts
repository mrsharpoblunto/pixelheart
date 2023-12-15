import autoprefixer from "autoprefixer";
import chalk from "chalk";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

import { ensurePath, getFileHash } from "./common-utils";

export const wwwPath = path.join(__dirname, "..", "www");
export const editorClientSrcPath = path.join(
  __dirname,
  "..",
  "game",
  "editor",
  "client"
);

const staticLogDecorator = (message: string) => {
  console.log(chalk.dim("[Static]"), message);
};

export function shouldWatch(): boolean {
  const config = getTailwindConfig();
  return config.content;
}

function getTailwindConfig(): any {
  const editorTailwindFile = path.join(
    editorClientSrcPath,
    "tailwind.config.js"
  );
  return existsSync(editorTailwindFile) ? require(editorTailwindFile) : null;
}

export async function processStatic(production: boolean) {
  await ensurePath(wwwPath);

  const tailwindConfig = getTailwindConfig();
  if (!production && tailwindConfig) {
    staticLogDecorator(`Found tailwind.config.js`);
  }

  staticLogDecorator(`Building ${chalk.green("index.html")}`);
  await fs.writeFile(
    path.join(wwwPath, "index.html"),
    await generateHtml(production, tailwindConfig)
  );
}

async function generateHtml(
  production: boolean,
  tailwindConfig: boolean
): Promise<string> {
  const hash = production
    ? await getFileHash(path.join(wwwPath, "index.js"))
    : null;

  const css = await generateCss(production, tailwindConfig);

  return `<!DOCTYPE html>
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
      }
      #root canvas {
        position: relative;
      }
    </style>
    ${css ? '<link rel="stylesheet" href="/editor.css">' : ""}
  </head>
  <body>
    <div id="root"></div>
    <script src="/js/index.js${hash ? "?v=" + hash : ""}"></script>
  </body>
</html>`;
}

async function generateCss(
  production: boolean,
  tailwindConfig: any
): Promise<boolean> {
  if (!production && tailwindConfig) {
    staticLogDecorator(`Building ${chalk.green("editor.css")}`);
    const result = await postcss([
      autoprefixer,
      tailwindcss({
        ...tailwindConfig,
        content: tailwindConfig?.content.map((c: any) =>
          path.join(editorClientSrcPath, c)
        ),
      }),
    ]).process(
      `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
      { from: undefined, to: "www/editor.css" }
    );
    await fs.writeFile(path.join(wwwPath, "editor.css"), result.css);
    return true;
  }
  return false;
}
