import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import watcher from "@parcel/watcher";
import chalk from "chalk";
import { spawn } from "child_process";
import {
  spritePath,
  wwwPath,
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
import { serve } from "esbuild";
import esbuildConfig from "./esbuild-config";
import { Worker } from "worker_threads";
import { codeFrameColumns, SourceLocation } from "@babel/code-frame";

const PORT = 8000;
const srcPath = path.join(__dirname, "..", "src");

let editor: Worker | null = null;

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
  await ensurePath(wwwPath);
  await ensurePath(spriteSrcPath);
  await ensurePath(shadersSrcPath);

  // on first run, check if any sprites are missing or older
  // than the source and build them
  const sourceSpriteSheets = await fs.readdir(spritePath);
  const destSpriteSheets = await fs.readdir(wwwPath);
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
      srcStat.mtimeMs > (await fs.stat(path.join(wwwPath, dest))).mtimeMs
    ) {
      await processSpriteSheet(src, false, spriteLogDecorator, spriteErrorDecorator);
    }
  }

  // then await other changes as they come
  await watcher.subscribe(spritePath, async (_err, events) => {
    await processSpriteSheetEvents(events);
  });

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

  // then await other changes as they come
  await watcher.subscribe(shadersPath, async (_err, events) => {
    await processShaderEvents(args.production, events);
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
        console.log(chalk.dim("[Editor]"), "Restarting...");
        editor?.postMessage({ actions: [{ type: "RESTART" }] });
        editor = null;
      },
      {
        ignore: ["client/**"],
      }
    );
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
    console.log(chalk.dim("[Editor]"), `Error - ${error.stack}`);
  });

  editor.on("exit", (code: number) => {
    console.log(chalk.dim("[Editor]"), `Closed (${code}).`);
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
      await fs.rm(path.join(wwwPath, `${d}.png`));
    } catch (ex) {}
  }

  for (let nom of newOrModified) {
    await processSpriteSheet(nom, false, spriteLogDecorator, spriteErrorDecorator);
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
          await processShader(
            path.basename(e.path),
            production,
            shaderLogDecorator,
            shaderErrorDecorator
          );
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