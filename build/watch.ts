import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fs from "fs/promises";
import path from "path";
import watcher from "@parcel/watcher";
import chalk from "chalk";
import { spawn } from "child_process";
import {
  spritePath,
  wwwPath as spriteWwwPath,
  spriteSrcPath,
  ensurePath,
  processSpriteSheet,
  isSpriteSource,
} from "./sprite-utils";
import {
  shadersPath,
  shadersSrcPath,
  processShader,
  isShader,
} from "./shader-utils";
import {
  mapsPath,
  mapSrcPath,
  wwwPath as mapsWwwPath,
  processMap,
  loadMapMetadata,
} from "./map-utils";
import { serve } from "esbuild";
import { EditorHost } from "../src/editor/host";
import esbuildConfig from "./esbuild-config";
import { codeFrameColumns, SourceLocation } from "@babel/code-frame";

const PORT = 8000;
const srcPath = path.join(__dirname, "..", "src");
const wwwPath = path.join(__dirname, "..", "www");

let editor: EditorHost;

const spriteLogDecorator = (message: string) => {
  console.log(chalk.dim("[Sprites]"), message);
};
const spriteErrorDecorator = (error: string) => {
  console.log(chalk.dim("[Sprites]"), chalk.red(error));
};
const shaderLogDecorator = (message: string) => {
  console.log(chalk.dim("[Shaders]"), message);
};
const shaderErrorDecorator = (error: string) => {
  console.log(chalk.dim("[Shaders]"), chalk.red(error));
};
const mapsLogDecorator = (message: string) => {
  console.log(chalk.dim("[Maps]"), message);
};
const mapsErrorDecorator = (error: string) => {
  console.log(chalk.dim("[Maps]"), chalk.red(error));
};

Promise.resolve(
  yargs(hideBin(process.argv))
    .option("production", {
      type: "boolean",
      flag: true,
      default: false,
    })
    .scriptName("watch")
    .usage("$0 args").argv
).then(async (args) => {
  await ensurePath(spriteWwwPath);
  await ensurePath(mapsWwwPath);
  await ensurePath(spriteSrcPath);
  await ensurePath(mapSrcPath);
  await ensurePath(shadersSrcPath);
  await fs.cp(
    path.join(srcPath, "index.html"),
    path.join(wwwPath, "index.html")
  );

  // on first run, check if any sprites are missing or older
  // than the source and build them
  const sourceSpriteSheets = await fs.readdir(spritePath);
  const destSpriteSheets = await fs.readdir(spriteWwwPath);
  for (const src of sourceSpriteSheets) {
    const srcStat = await fs.stat(path.join(spritePath, src));
    if (srcStat.isFile()) {
      continue;
    }
    const dest = destSpriteSheets.find(
      (d) =>
        d === `${src}-diffuse.png` ||
        d === `${src}-normal.png` ||
        d === `${src}-emissive.png`
    );
    if (
      // doesn't exist
      !dest ||
      // or is older than the source
      srcStat.mtimeMs > (await fs.stat(path.join(spriteWwwPath, dest))).mtimeMs
    ) {
      await processSpriteSheet(
        src,
        false,
        spriteLogDecorator,
        spriteErrorDecorator
      );
    }
  }

  // on first run, check if any maps are missing or older
  // than the source and build them.
  const sourceMaps = await fs.readdir(mapsPath);
  const destMaps = await fs.readdir(mapsWwwPath);
  for (const src of sourceMaps) {
    const srcStat = await fs.stat(path.join(mapsPath, src));
    if (srcStat.isFile()) {
      continue;
    }
    const dest = destMaps.find((d) => d === `${src}.png`);
    if (
      // doesn't exist
      !dest ||
      // or is older than the source
      srcStat.mtimeMs > (await fs.stat(path.join(mapsWwwPath, dest))).mtimeMs
    ) {
      await processMap(src, mapsLogDecorator, mapsErrorDecorator);
    }
  }

  // on first run, check if any shader type definitions are missing or older
  // than the source and build them
  const sourceShaders = await fs.readdir(shadersPath);
  const destShaders = await fs.readdir(shadersSrcPath);
  const shadersToType = [];
  for (const src of sourceShaders) {
    const srcStat = await fs.stat(path.join(shadersPath, src));
    if (!isShader(src)) {
      continue;
    }

    const dest = `${src}.ts`;
    if (
      // doesn't exist
      destShaders.indexOf(dest) < 0 ||
      // or is older than the source
      srcStat.mtimeMs > (await fs.stat(path.join(shadersSrcPath, dest))).mtimeMs
    ) {
      shadersToType.push(src);
    }
  }
  await Promise.all(
    shadersToType.map((s) =>
      processShader(
        s,
        args.production,
        shaderLogDecorator,
        shaderErrorDecorator
      )
    )
  );

  // await other sprite changes as they come
  await watcher.subscribe(spritePath, async (_err, events) => {
    await processSpriteSheetEvents(events);
  });
  // await other changes to shaders as they come
  await watcher.subscribe(shadersPath, async (_err, events) => {
    await processShaderEvents(args.production, events);
  });
  // NOTE: we also watch for sprite changes here because maps depend on
  // sprites and we want to rebuild them if a sprite changes.
  await watcher.subscribe(spriteSrcPath, async (_err, events) => {
    await processMapSpriteEvents(events);
  });
  await watcher.subscribe(mapsPath, async (_err, events) => {
    await processMapEvents(events);
  });

  // run the esbuild watcher
  await serve(
    {
      port: PORT + 1,
      servedir: path.join(__dirname, "..", "www"),
      onRequest: (args) => {
        console.log(
          chalk.dim("[Server]"),
          `[${args.method}] ${args.path} ${(args.status >= 200 &&
            args.status < 400
            ? chalk.green
            : chalk.red)(args.status)}`
        );
      },
    },
    {
      color: true,
      logLevel: "info",
      ...esbuildConfig(args.production),
    }
  );

  // avoid having to constantly reload files to display TSC errors
  const fileCache = new Map<string, string>();
  setInterval(() => {
    fileCache.clear();
  }, 5000);

  const TS_ERROR_REGEX = /(.*)\(([0-9]*),([0-9]*)\): error (TS[0-9]*): (.*)/m;

  // run tsc watcher
  const tsc = spawn("./node_modules/.bin/tsc", ["--watch", "--noEmit"]);
  tsc.stdout.on("data", async (data) => {
    const str = data.toString().replace(/\x1Bc/g, "").trim();
    const match = TS_ERROR_REGEX.exec(str);
    if (match) {
      const filePath = path.join(__dirname, "..", match[1]);
      const cachedLines = fileCache.get(filePath);
      const rawLines =
        cachedLines ||
        (await fs.readFile(path.join(__dirname, "..", match[1]), "utf-8"));
      if (!cachedLines) {
        fileCache.set(filePath, rawLines);
      }
      const location: SourceLocation = {
        start: { line: parseInt(match[2], 10), column: parseInt(match[3], 10) },
      };
      const result = codeFrameColumns(rawLines, location, {
        highlightCode: true,
        message: match[5],
      });
      console.log(
        chalk.dim("[TSC]"),
        chalk.red(`Error ${match[4]} in ${match[1]}`)
      );
      console.log(result);
    } else {
      console.log(chalk.dim("[TSC]"), str);
    }
  });
  tsc.stderr.on("data", (data) => {
    console.log(chalk.dim("[TSC]"), chalk.red(data.toString()));
  });
  tsc.on("close", (code) => {
    console.log(chalk.dim("[TSC]"), `TSC closed ${code}`);
  });

  // start the proxy to esbuild & the dev editor API
  const app = express();

  if (!args.production) {
    editor = new EditorHost(PORT + 2, srcPath);
  } else {
    console.log(
      `${chalk.dim("[Editor]")} ${chalk.red("Disabled in production builds")}`
    );
  }

  const proxyMiddleware = createProxyMiddleware({
    target: `http://127.0.0.1:${PORT + 1}`,
    logProvider: (provider) => {
      provider.log = (...args: any[]) =>
        console.log(chalk.dim("[Proxy]"), ...args);
      provider.debug = (...args: any[]) =>
        console.log(chalk.dim("[Proxy]"), ...args);
      provider.info = (...args: any[]) =>
        console.log(chalk.dim("[Proxy]"), ...args);
      provider.warn = (...args: any[]) =>
        console.log(chalk.dim("[Proxy]"), ...args.map((a) => chalk.yellow(a)));
      provider.error = (...args: any[]) =>
        console.log(chalk.dim("[Proxy]"), ...args.map((a) => chalk.red(a)));
      return provider;
    },
    logLevel: "warn",
  });

  app.use((req, res, next) =>
    req.originalUrl.startsWith("/edit")
      ? next()
      : proxyMiddleware(req, res, next)
  );
  app.listen(PORT, () => {
    console.log(chalk.dim("[Server]"), `Listening on port ${PORT}`);
  });
});

async function processMapSpriteEvents(events: watcher.Event[]) {
  // if a sprite rev index.json changes, rebuild any maps
  // which have a metadata.sprite field that matches the
  // changed file
  for (let e of events) {
    if (path.extname(e.path) === ".json") {
      const sprite = path.basename(e.path, ".json");

      const maps = await fs.readdir(mapsPath);
      for (const map of maps) {
        const srcStat = await fs.stat(path.join(mapsPath, map));
        if (srcStat.isFile()) {
          continue;
        }
        const result = await loadMapMetadata(map);
        if (result.ok && result.metadata.spriteSheet === sprite) {
          await processMap(map, mapsLogDecorator, mapsErrorDecorator);
          editor?.broadcast({ type: "RELOAD_MAP", map });
        }
      }
    }
  }
}

async function processMapEvents(events: watcher.Event[]) {
  const newOrModified = new Set<string>();
  const deleted = [];
  for (let e of events) {
    const components = e.path.substring(mapsPath.length + 1).split("/");
    switch (e.type) {
      case "create":
      case "update":
        if (components.length === 1 || components[1] === "metadata.json") {
          newOrModified.add(components[0]);
        }
        break;

      case "delete":
        {
          if (components.length === 1) {
            deleted.push(components[0]);
          }
        }
        break;
    }
  }

  for (const d of deleted) {
    await fs.rm(path.join(mapSrcPath, `${d}.ts`));
    await fs.rm(path.join(mapsWwwPath, `${d}.png`));
  }

  for (const nom of newOrModified) {
    await processMap(nom, mapsLogDecorator, mapsErrorDecorator);
    editor?.broadcast({ type: "RELOAD_MAP", map: nom });
  }
}

async function processSpriteSheetEvents(events: watcher.Event[]) {
  const newOrModified = new Set<string>();
  const deleted = [];
  for (let e of events) {
    const components = e.path.substring(spritePath.length + 1).split("/");
    switch (e.type) {
      case "create":
      case "update":
        {
          // if the spritesheet or a png has been added/changed. We ignore
          // other stuff because image editing apps can create tmp files while saving etc..
          if (components.length === 1 || isSpriteSource(e.path)) {
            newOrModified.add(components[0]);
          }
        }
        break;

      case "delete":
        {
          // if its a toplevel spritesheet directory, remove the spritesheet
          // if its a sprite in a sheet, modify the spritesheet
          if (components.length === 1) {
            spriteLogDecorator(`Removing sprite sheet ${components[0]}...`);
            deleted.push(components[0]);
          } else if (isSpriteSource(e.path)) {
            newOrModified.add(components[0]);
          }
        }
        break;
    }
  }

  for (let d of deleted) {
    try {
      await fs.rm(path.join(srcPath, `${d}.ts`));
      await fs.rm(path.join(spriteWwwPath, `${d}.png`));
    } catch (ex) {}
  }

  for (let nom of newOrModified) {
    const spriteSheet = await processSpriteSheet(
      nom,
      false,
      spriteLogDecorator,
      spriteErrorDecorator
    );
    if (spriteSheet) {
      editor?.broadcast({
        type: "RELOAD_SPRITESHEET",
        spriteSheet,
      });
    }
  }
}

async function processShaderEvents(
  production: boolean,
  events: watcher.Event[]
) {
  for (let e of events) {
    if (!isShader(e.path)) {
      continue;
    }

    switch (e.type) {
      case "create":
      case "update":
        {
          const shader = path.basename(e.path);
          const src = await processShader(
            shader,
            production,
            shaderLogDecorator,
            shaderErrorDecorator
          );
          if (src) {
            editor?.broadcast({ type: "RELOAD_SHADER", shader, src });
          }
        }
        break;

      case "delete":
        {
          await fs.rm(e.path);
          await fs.rm(`${e.path}.d.ts`);
        }
        break;
    }
  }
}
