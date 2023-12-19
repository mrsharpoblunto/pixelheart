import autoprefixer from "autoprefixer";
import chalk from "chalk";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

import { ensurePath, getFileHash, getStringHash } from "./common-utils";

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

export async function processStatic(
  production: boolean
): Promise<{ [key: string]: string }> {
  await ensurePath(wwwPath);

  const tailwindConfig = getTailwindConfig();
  if (!production && tailwindConfig) {
    staticLogDecorator(`Found tailwind.config.js`);
  }

  staticLogDecorator(`Building ${chalk.green("index.html")}`);
  return await generateHtml(production, tailwindConfig);
}

async function getStaticHashes(root: string, base: string, files: Map<string, string>): Promise<void> {
  const found = await fs.readdir(base);
  for (const file of found) {
    const absolutePath = path.join(base, file);
    const stat = await fs.stat(absolutePath);
    if (stat.isDirectory()) {
      await getStaticHashes(root, absolutePath, files);
    } else {
      const relativePath = absolutePath.substring(root.length);
      files.set(relativePath, await getFileHash(absolutePath));
    }
}
}

async function generateHtml(
  production: boolean,
  tailwindConfig: boolean
): Promise<{ [key: string]: string }> {
  const result: { [key: string]: string } = {};

  const jsHash = production
    ? await getFileHash(path.join(wwwPath, "js", "index.js"))
    : null;
  result["/js/index.js"] = jsHash ? `/js/index.js?v=${jsHash}` : "/js/index.js";

  const cssHash = await generateCss(production, tailwindConfig);
  if (cssHash) {
    result["/editor.css"] = `/editor.css?v=${cssHash}`;
  }

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
    ${
      result["/editor.css"]
        ? `<link rel="stylesheet" href="${result["/editor.css"]}">`
        : ""
    }
  </head>
  <body>
    <div id="root"></div>
    <script type="text/javascript">
    window.__gamePluginUrl = "/js/game-plugin.js";
    </script>
    <script src="${result["/js/index.js"]}"></script>
  </body>
</html>`;

  await fs.writeFile(path.join(wwwPath, "index.html"), html);
  result["/index.html"] = `/index.html?v=${getStringHash(html)}`;
  return result;
}

async function generateCss(
  production: boolean,
  tailwindConfig: any
): Promise<string | null> {
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
    return getStringHash(result.css);
  }
  return null;
}
