import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import watcher from "@parcel/watcher";
import {
  spritePath,
  wwwPath,
  spriteSrcPath,
  ensurePath,
  processSpriteSheet,
} from "./sprite-utils";
import * as esbuild from "esbuild";
import { Worker } from "worker_threads";

const PORT = 8000;

const srcPath = path.join(__dirname, "../src");
let editor: Worker | null = null;

Promise.resolve(
  yargs(hideBin(process.argv)).scriptName("watch").usage("$0 args").argv
).then(async (_args) => {
  await ensurePath(wwwPath);
  await ensurePath(spriteSrcPath);
  const sourceSpriteSheets = await fs.readdir(spritePath);
  const destSpriteSheets = await fs.readdir(wwwPath);

  // on first run, check if any sprites are missing or older
  // than the source and build them
  for (const src of sourceSpriteSheets) {
    const srcStat = await fs.stat(path.join(spritePath, src));
    if (srcStat.isFile()) {
      continue;
    }
    const dest = `${src}.png`;
    if (
      destSpriteSheets.find(
        (d) =>
          d === `${src}-diffuse.png` ||
          d === `${src}-normal.png` ||
          d === `${src}-emissive.png`
      )
    ) {
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
      color: true,
      logLevel: "info",
      bundle: true,
      outdir: path.join(__dirname, "../www/js"),
      define: {
        ["process.env.NODE_ENV"]: '"development"',
      },
      entryPoints: [path.join(__dirname, "../src/client/index.ts")],
    }
  );

  // start the proxy to esbuild & the dev editor API
  const app = express();
  app.use(express.json());

  const requestMap = new Map<
    string,
    {
      res: express.Response;
    }
  >();
  createEditor(app, requestMap);

  app.post("/edit", (req, res) => {
    const requestId = uuidv4();
    requestMap.set(requestId, { res });
    if (!editor) {
      res.status(500).send("Editor not ready");
    } else {
      editor.postMessage({
        requestId,
        actions: req.body,
      });
    }
  });

  await watcher.subscribe(
    srcPath,
    async (_err, _events) => {
      console.log("Restarting Editor...");
      editor?.postMessage({ actions: [{ type: "RESTART" }] });
      editor = null;
    },
    {
      ignore: ["client/**"],
    }
  );

  const proxyMiddleware = createProxyMiddleware({
    target: `http://127.0.0.1:${PORT + 1}`,
  });

  app.use((req, res, next) =>
    req.originalUrl.startsWith("/edit")
      ? next()
      : proxyMiddleware(req, res, next)
  );
  app.listen(PORT);
});

function createEditor(
  app: express.Express,
  requestMap: Map<
    string,
    {
      res: express.Response;
    }
  >
) {
  editor = new Worker(path.join(srcPath, "editor", "worker.ts"), {
    eval: false,
    workerData: null,
    execArgv: ["-r", "ts-node/register"],
  });

  editor.on("error", (error: any) => {
    console.error(`Editor: Error - ${error.stack}`);
  });

  editor.on("exit", (code: number) => {
    console.log(`Editor: Closed (${code}).`);
    // clear out pending requests so the client can
    // be notified of the failure and re-send the requests
    for (let req of requestMap.values()) {
      req.res.status(500).send("Editor not ready");
    }
    requestMap.clear();
    createEditor(app, requestMap);
  });

  editor.on("message", (message: any) => {
    const request = requestMap.get(message.requestId);
    if (request) {
      if (message.response) {
        requestMap.delete(message.requestId);
        request.res.json(message.response);
      }
    }
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
