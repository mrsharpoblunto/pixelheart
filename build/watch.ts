import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fs from "fs/promises";
import path from "path";
import watcher from "@parcel/watcher";
import {
  spritePath,
  wwwPath,
  srcPath,
  ensurePath,
  processSpriteSheet,
} from "./sprite-utils";
import * as esbuild from "esbuild";

const PORT = 8000;

Promise.resolve(
  yargs(hideBin(process.argv)).scriptName("watch").usage("$0 args").argv
).then(async (_args) => {
  await ensurePath(wwwPath);
  await ensurePath(srcPath);
  const sourceSpriteSheets = await fs.readdir(spritePath);
  const destSpriteSheets = await fs.readdir(wwwPath);

  // on first run, check if any sprites are missing or older
  // than the source and build them
  for (const src of sourceSpriteSheets) {
    const srcStat = await fs.stat(path.join(spritePath, src));
    const dest = `${src}.png`;
    if (destSpriteSheets.find((d) => d === dest)) {
      const destStat = await fs.stat(path.join(wwwPath, dest));
      if (srcStat.mtimeMs > destStat.mtimeMs) {
        await processSpriteSheet(src, console.error);
      }
    } else {
      await processSpriteSheet(src, console.error);
    }
  }

  // then await other changes as they come
  await watcher.subscribe(spritePath, async (_err, events) => {
    await processSpriteSheetEvents(events);
  });

  // run the esbuild watcher
  await esbuild.serve(
    {
      port: PORT + 1,
      servedir: path.join(__dirname, "../www"),
    },
    {
      bundle: true,
      outdir: path.join(__dirname, "../www/js"),
      define: {
        ["process.env.NODE_ENV"]: '"development"',
      },
      entryPoints: [path.join(__dirname, "../src/index.ts")],
    }
  );

  // start the proxy to esbuild & the dev editor API
  const app = express();
  createEditorAPI(app);
  app.use(
    "/*",
    createProxyMiddleware({
      target: `http://localhost:${PORT + 1}`,
    })
  );
  app.listen(PORT);
});

function createEditorAPI(app: express.Express) {
  app.get("/editor", (_req, res) => {
    // TODO edit & update maps
    res.json({ foo: "bar" });
  });
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
          if (components.length === 1 || path.extname(e.path) === ".png") {
            newOrModified.add(components[0]);
          }
        }
        break;

      case "delete":
        {
          // if its a toplevel spritesheet directory, remove the spritesheet
          // if its a sprite in a sheet, modify the spritesheet
          if (components.length === 1) {
            console.log(`Removing ${components[0]}...`);
            deleted.push(components[0]);
          } else if (path.extname(e.path) === ".png") {
            newOrModified.add(components[0]);
          }
        }
        break;
    }
  }

  for (let d of deleted) {
    try {
      await fs.rm(path.join(srcPath, `${d}.ts`));
      await fs.rm(path.join(wwwPath, `${d}.png`));
    } catch (ex) {}
  }

  for (let nom of newOrModified) {
    await processSpriteSheet(nom, console.error);
  }
}
