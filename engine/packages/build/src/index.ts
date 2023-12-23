import { SourceLocation, codeFrameColumns } from "@babel/code-frame";
import watcher from "@parcel/watcher";
import chalk from "chalk";
import { spawn } from "child_process";
import compression from "compression";
import express from "express";
import fs from "fs/promises";
import path from "path";
import url from "url";
import yargs, { Argv } from "yargs";
import { hideBin } from "yargs/helpers";
import { EventEmitter } from "events";
import { existsSync } from "fs";

import { EditorServerHost } from "@pixelheart/server";

import { BuildContext, BuildPlugin } from "./plugin.js";
import { Logger } from "./logger.js";

const PORT = 8000;
const dirname = path.dirname(url.fileURLToPath(import.meta.url));


interface LoadedBuildPlugin {
  name: string;
  plugin: BuildPlugin;
}

interface CommonBuildOptions {
  production: boolean;
  clean: boolean;
  gamePath: string;
  gameAssetPath: string | undefined;
  gameClientPath: string | undefined;
  gameBuildPath: string | undefined;
  gameOutputPath: string;
  enableCustomBuildPlugins: boolean;
  buildPluginFilter: Array<string> | undefined;
}

interface BuildOptions extends CommonBuildOptions {
  serve: boolean;
  port: number;
}

interface RunOptions extends CommonBuildOptions {
  port: number;
}

class BuildContextImpl extends Logger implements BuildContext {
  #eventEmitter: EventEmitter | undefined;
  production: boolean;
  clean: boolean;
  build: boolean;
  watch: false | { port: number };
  gamePath: string;
  gameAssetPath: string;
  gameClientPath: string;
  gameBuildPath: string;
  gameEditorClientPath: string;
  gameEditorServerPath: string;
  gameOutputPath: string;

  constructor(args: {
    production: boolean,
    clean: boolean,
    build: boolean,
    watch: false | { port: number },
    gamePath: string,
    gameAssetPath?: string,
    gameBuildPath?: string,
    gameClientPath?: string,
    gameOutputPath: string,
  }, eventEmitter?: EventEmitter) {
    super(!args.watch);
    this.#eventEmitter = eventEmitter;
    this.production = args.production;
    this.clean = args.clean;
    this.build = true;
    this.watch = args.watch;
    this.gamePath = path.resolve(process.cwd(), args.gamePath);
    this.gameAssetPath = path.resolve(
      process.cwd(),
      args.gameAssetPath || path.join(args.gamePath, "assets")
    );
    this.gameClientPath = path.resolve(
      process.cwd(),
      args.gameClientPath || path.join(args.gamePath, "client")
    );
    this.gameBuildPath = path.resolve(
      process.cwd(),
      args.gameBuildPath || path.join(args.gamePath, "build")
    );
    this.gameEditorClientPath = path.resolve(
      process.cwd(),
      path.join(args.gamePath, "editor", "client")
    );
    this.gameEditorServerPath = path.resolve(
      process.cwd(),
      path.join(args.gamePath, "editor", "server")
    );
    this.gameOutputPath = path.resolve(process.cwd(), args.gameOutputPath);
  }

  emit(e: any) {
    this.#eventEmitter?.emit("event", e);
  }
}

const buildCommand = {
  command: "build",
  describe: "Builds a game",
  builder: (yargs: Argv<CommonBuildOptions>): Argv<BuildOptions> =>
    yargs
      .option("serve", {
        type: "boolean",
        flag: true,
        default: false,
      })
      .option("port", {
        type: "number",
        default: PORT,
      }),

  handler: async (args: BuildOptions) => {
    const buildContext = new BuildContextImpl({
      ...args,
      watch: false,
      build: true,
    });

    const plugins = await loadBuildPlugins(buildContext, {
      filter: args.buildPluginFilter,
      customBuildPluginsPath: args.enableCustomBuildPlugins ? buildContext.gameBuildPath : null,
    });

    const success = await executeBuildPlugins(
      buildContext,
      plugins
    );

    buildContext.log();
    if (success) {
      buildContext.warn(`Build completed with ${buildContext.errorCount} error(s)`);
    } else {
      buildContext.log(chalk.green("Build complete"));
    }

    if (args.serve) {
      const app = express();
      app.use(compression());
      app.use(express.static(buildContext.gameOutputPath));
      app.listen(args.port, () => {
        buildContext.push("server")
        buildContext.log();
        buildContext.log(`Running at http://localhost:${args.port}`);
        buildContext.pop();
      });
    }
  },
};

const runCommand = {
  command: "run",
  describe: "Builds a game and starts a dev server",
  builder: (yargs: Argv<CommonBuildOptions>): Argv<RunOptions> =>
    yargs
      .option("port", {
        type: "number",
        default: PORT,
      }),

  handler: async (args: RunOptions) => {
    const editor = args.production
      ? undefined
      : new EditorServerHost(
        args.port + 1,
        path.join(args.gamePath, "editor", "server"),
        args.gameOutputPath
      );

    const buildContext = new BuildContextImpl({
      ...args,
      build: true,
      watch: { port: args.port },
    }, editor);

    if (!editor) {
      buildContext.push("editor");
      buildContext.warn("Disabled in production builds");
      buildContext.pop();
    }

    const plugins = await loadBuildPlugins(buildContext, {
      filter: args.buildPluginFilter,
      customBuildPluginsPath: args.enableCustomBuildPlugins ? buildContext.gameBuildPath : null,
    });

    const success = await executeBuildPlugins(
      buildContext,
      plugins
    );

    buildContext.log();
    if (success) {
      buildContext.warn(`Build completed with ${buildContext.errorCount} error(s)`);
    } else {
      buildContext.log(chalk.green("Build complete"));
    }

    watchTypescript(buildContext.gameOutputPath);
  },
};

const cleanCommand = {
  command: "clean",
  describe: "Cleans all built game output",
  builder: (yargs: Argv<CommonBuildOptions>) => yargs,

  handler: async (args: CommonBuildOptions) => {
    const buildContext = new BuildContextImpl({
      ...args,
      clean: true,
      build: false,
      watch: false,
    });

    const plugins = await loadBuildPlugins(buildContext, {
      filter: args.buildPluginFilter,
      customBuildPluginsPath: args.enableCustomBuildPlugins ? buildContext.gameBuildPath : null,
    });

    // build game assets
    await executeBuildPlugins(
      buildContext,
      plugins
    );
  },
};

Promise.resolve(
  yargs(hideBin(process.argv))
    .option("gamePath", {
      type: "string",
      default: ".",
    })
    .option("gameAssetPath", {
      type: "string",
      hidden: true,
    })
    .option("gameClientPath", {
      type: "string",
      hidden: true,
    })
    .option("gameBuildPath", {
      type: "string",
      hidden: true,
    })
    .option("gameOutputPath", {
      type: "string",
      required: true,
    })
    .option("enableCustomBuildPlugins", {
      type: "boolean",
      hidden: true,
      flag: true,
      default: true,
    })
    .option("buildPluginFilter", {
      type: "string",
      array: true,
    })
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
    .command(buildCommand)
    .command(runCommand)
    .command(cleanCommand)
    .demandCommand(1)
    .strict()
    .scriptName("pixelheart")
    .usage("$0 <cmd> args")
    .fail((msg, err, yargs) => {
      console.log(err);
      process.exit(1);
    }).argv
);

async function loadBuildPlugins(ctx: BuildContext, args: {
  customBuildPluginsPath: string | null,
  filter: Array<string> | undefined
}): Promise<Array<LoadedBuildPlugin>> {
  const plugins: Array<LoadedBuildPlugin> = [];
  const pluginRoots = [path.join(dirname, "plugins")];
  if (args.customBuildPluginsPath) {
    if (!existsSync(args.customBuildPluginsPath)) {
      ctx.warn(`Custom build plugins path ${args.customBuildPluginsPath} does not exist`);
    } else {
      pluginRoots.push(args.customBuildPluginsPath);
    }
  }

  for (const r of pluginRoots) {
    const pluginFiles = await fs.readdir(r);
    for (const p of pluginFiles) {
      if (p.indexOf(".d.ts") > -1) {
        continue;
      }
      const pluginName = p.replace(path.extname(p), "");
      if (!args.filter || args.filter.includes(pluginName)) {
        const pluginPath = path.join(r, p);
        const plugin = await import(pluginPath);
        plugins.push({
          name: pluginName,
          plugin: new plugin.default() as BuildPlugin,
        });
      }
    }
  }
  return topologicalSort(ctx, plugins);
}

async function executeBuildPlugins(
  ctx: BuildContext,
  plugins: Array<LoadedBuildPlugin>
): Promise<boolean> {
  if (ctx.clean) {
    try {
      await fs.rm(ctx.gameOutputPath, { recursive: true, force: true });
    } catch (e) { }
  }

  for (const plugin of plugins) {
    ctx.push(plugin.name);
    try {
      if (ctx.clean) {
        await plugin.plugin.clean(ctx);
      }
      if (ctx.build && (await plugin.plugin.init(ctx))) {
        try {
          await plugin.plugin.build(ctx);
        } catch (e) {
          ctx.error((e as Error).message);
        }
        if (ctx.watch) {
          await plugin.plugin.watch(ctx, watcher.subscribe);
        }
      }
    } finally {
      ctx.pop();
    }
  }
  return ctx.errorCount === 0;
}

function topologicalSort(
  ctx: BuildContext,
  plugins: Array<LoadedBuildPlugin>
): Array<LoadedBuildPlugin> {
  const edges = new Map<string, LoadedBuildPlugin>();
  plugins.forEach((p) => edges.set(p.name, p));

  const sorted: LoadedBuildPlugin[] = [];
  const visited = new Set<string>();
  const temp = new Set<string>();

  try {
    const visit = (p: LoadedBuildPlugin, stack: Set<string>) => {
      if (visited.has(p.name)) return;
      if (stack.has(p.name)) {
        throw new Error(`Circular build dependency detected: ${p.name}`);
      }

      stack.add(p.name);

      p.plugin.depends.forEach((depName: string) => {
        const dep = edges.get(depName);
        if (dep) visit(dep, stack);
      });

      visited.add(p.name);
      stack.delete(p.name);
      sorted.push(p);
    };

    plugins.forEach((p) => visit(p, temp));
    return sorted;
  } catch (e: any) {
    ctx.error(e.message);
    return plugins;
  }
}

function watchTypescript(gameRoot: string) {
  // avoid having to constantly reload files to display TSC errors
  const fileCache = new Map<string, string>();
  setInterval(() => {
    fileCache.clear();
  }, 5000);

  const TS_ERROR_REGEX = /(.*)\(([0-9]*),([0-9]*)\): error (TS[0-9]*): (.*)/m;

  // run tsc watcher
  const tsc = spawn(path.join(dirname, "../node_modules/.bin/tsc"), ["--watch", "--noEmit"], {
    cwd: path.join(gameRoot),
  });
  tsc.stdout.on("data", async (data) => {
    const str = data.toString().replace(/\x1Bc/g, "").trim();
    const match = TS_ERROR_REGEX.exec(str);
    if (match) {
      const filePath = path.join(gameRoot, match[1]);
      const cachedLines = fileCache.get(filePath);
      const rawLines =
        cachedLines ||
        (await fs.readFile(path.join(gameRoot, match[1]), "utf-8"));
      if (!cachedLines) {
        fileCache.set(filePath, rawLines);
      }
      const location: SourceLocation = {
        start: {
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
        },
      };
      const result = codeFrameColumns(rawLines, location, {
        highlightCode: true,
        message: match[5],
      });
      console.log(
        chalk.dim("[tsc]"),
        chalk.red(`Error ${match[4]} in ${match[1]}`)
      );
      console.log(result);
    } else {
      if (str != "") {
        console.log(chalk.dim("[tsc]"), str);
      }
    }
  });
  tsc.stderr.on("data", (data) => {
    console.log(chalk.dim("[tsc]"), chalk.red(data.toString()));
  });
  tsc.on("close", (code) => {
    console.log(chalk.dim("[tsc]"), `TSC closed ${code}`);
  });
}
