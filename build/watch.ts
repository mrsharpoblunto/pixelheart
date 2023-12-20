import { SourceLocation, codeFrameColumns } from "@babel/code-frame";
import watcher from "@parcel/watcher";
import chalk from "chalk";
import { spawn } from "child_process";
import * as esbuild from "esbuild";
import fs from "fs/promises";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { ensurePath } from "@pixelheart/file-utils";

import { EditorServerHost } from "../src/editor-server-host";
import esbuildConfig from "./esbuild-config";
import { BuildContext, BuildPlugin } from "./plugin";
import EditorTailwindcssPlugin from "./plugins/editor-tailwindcss";
import HtmlPlugin from "./plugins/html";
import MapPlugin from "./plugins/map";
import ShaderPlugin from "./plugins/shader";
import SpritePlugin from "./plugins/sprite";
import StaticPlugin from "./plugins/static";

const PORT = 8000;

Promise.resolve(
  yargs(hideBin(process.argv))
    .option("production", {
      type: "boolean",
      flag: true,
      default: false,
    })
    .option("clean", {
      type: "boolean",
      flag: true,
      default: false,
    })
    .scriptName("watch")
    .usage("$0 args").argv
).then(async (args) => {
  const editor = args.production
    ? null
    : new EditorServerHost(
        PORT + 1,
        path.join(__dirname, "..", "game", "editor", "server")
      );

  if (!editor) {
    console.log(
      `${chalk.dim("[Editor]")} ${chalk.red("Disabled in production builds")}`
    );
  }

  const buildContext = {
    production: args.production,
    clean: args.clean,
    gameRoot: path.join(__dirname, "..", "game"),
    assetRoot: path.join(__dirname, "..", "game", "assets"),
    srcRoot: path.join(__dirname, "..", "game", "client", "generated"),
    outputRoot: path.join(__dirname, "..", "www"),
    log: console.log,
    onError: console.error,
  };

  if (buildContext.clean) {
    try {
      await fs.rm(buildContext.outputRoot);
    } catch (e) {}
  }

  // build game assets
  await executeBuildPlugins(
    buildContext,
    [
      new SpritePlugin(),
      new MapPlugin(),
      new ShaderPlugin(),
      new EditorTailwindcssPlugin(),
      new StaticPlugin(),
      new HtmlPlugin(),
    ],
    editor
  );

  // build core shaders
  await executeBuildPlugins(
    {
      ...buildContext,
      assetRoot: path.join(__dirname, "..", "src", "assets"),
      srcRoot: path.join(__dirname, "..", "src", "generated"),
    },
    [new ShaderPlugin()],
    editor
  );

  const ctx = await esbuild.context({
    logLevel: "silent",
    ...esbuildConfig(buildContext.production),
  });

  // run the esbuild server
  const { port } = await ctx.serve({
    port: PORT,
    servedir: buildContext.outputRoot,
    onRequest: (args: any) => {
      console.log(
        chalk.dim("[Server]"),
        `[${args.method}] ${args.path} ${(args.status >= 200 &&
          args.status < 400
          ? chalk.green
          : chalk.red)(args.status)}`
      );
    },
  });
  await ctx.watch({});
  console.log(chalk.dim("[Server]"), `Listening on ${port}`);

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
      if (str != "") {
        console.log(chalk.dim("[TSC]"), str);
      }
    }
  });
  tsc.stderr.on("data", (data) => {
    console.log(chalk.dim("[TSC]"), chalk.red(data.toString()));
  });
  tsc.on("close", (code) => {
    console.log(chalk.dim("[TSC]"), `TSC closed ${code}`);
  });
});

async function executeBuildPlugins(
  ctx: BuildContext,
  plugins: Array<BuildPlugin>,
  editor: EditorServerHost | null
) {
  for (const plugin of plugins) {
    const pluginCtx = {
      ...ctx,
      log: (message: string) => {
        console.log(chalk.dim(`[${plugin.getName()}]`), message);
      },
      onError: (error: string) => {
        console.log(chalk.dim(`[${plugin.getName()}]`), chalk.red(error));
      },
    };
    plugin.on("event", (event) => {
      editor?.emit("event", event);
    });
    if (ctx.clean) {
      await plugin.clean(pluginCtx);
    }
    if (await plugin.init(pluginCtx)) {
      await plugin.build(pluginCtx, !ctx.clean);
      await plugin.watch(pluginCtx, watcher.subscribe);
    }
  }
}
