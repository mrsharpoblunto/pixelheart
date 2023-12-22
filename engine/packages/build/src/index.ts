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

import { EditorServerHost } from "@pixelheart/server";

import { BuildContext, BuildPlugin } from "./plugin.js";

const PORT = 8000;
const dirname = path.dirname(url.fileURLToPath(import.meta.url));


interface LoadedBuildPlugin {
  name: string;
  plugin: BuildPlugin;
}

interface CommonBuildOptions {
  game: string;
  assets: string | undefined;
  src: string | undefined;
  build: string | undefined;
  customPlugins: boolean;
  output: string;
  plugins: Array<string> | undefined;
}

interface BuildOptions extends CommonBuildOptions {
  watch: boolean;
  production: boolean;
  clean: boolean;
  serve: boolean;
  port: number;
}

interface RunOptions extends CommonBuildOptions {
  clean: boolean;
  production: boolean;
  port: number;
}

const buildCommand = {
  command: "build",
  describe: "Builds a game",
  builder: (yargs: Argv<CommonBuildOptions>): Argv<BuildOptions> =>
    yargs
      .option("watch", {
        type: "boolean",
        flag: true,
        default: false,
      })
      .option("production", {
        type: "boolean",
        flag: true,
        default: true,
      })
      .option("clean", {
        type: "boolean",
        flag: true,
        default: false,
      })
      .option("port", {
        type: "number",
        default: PORT,
      })
      .option("serve", {
        type: "boolean",
        flag: true,
        default: false,
      }),
  handler: async (args: BuildOptions) => {
    const buildContext = {
      production: args.production,
      port: args.port,
      clean: args.clean,
      build: true,
      watch: args.watch,
      gameRoot: path.resolve(process.cwd(), args.game),
      assetRoot: path.resolve(
        process.cwd(),
        args.assets || path.join(args.game, "assets")
      ),
      srcRoot: path.resolve(
        process.cwd(),
        args.src || path.join(args.game, "client")
      ),
      outputRoot: path.resolve(process.cwd(), args.output),
      event: () => {},
    };

    await executeBuildPlugins(
      buildContext,
      await loadBuildPlugins(
        args.customPlugins ? args.build || path.join(args.game, "build") : null,
        args.plugins
      )
    );

    console.log();
    console.log(chalk.green("Build complete"));

    if (args.serve) {
      const app = express();
      app.use(compression());
      app.use(express.static(buildContext.outputRoot));
      app.listen(PORT, () => {
        console.log();
        console.log(
          `${chalk.dim("[server]")} Running at http://localhost:${args.port}`
        );
      });
    }
  },
};

const runCommand = {
  command: "run",
  describe: "Builds a game and starts a dev server",
  builder: (yargs: Argv<CommonBuildOptions>): Argv<RunOptions> =>
    yargs
      .option("production", {
        type: "boolean",
        flag: true,
        default: false,
      })
      .option("port", {
        type: "number",
        default: PORT,
      })
      .option("clean", {
        type: "boolean",
        flag: true,
        default: false,
      }),

  handler: async (args: RunOptions) => {
    const buildContext = {
      production: args.production,
      port: args.port,
      clean: args.clean,
      build: true,
      watch: true,
      gameRoot: path.resolve(process.cwd(), args.game),
      assetRoot: path.resolve(
        process.cwd(),
        args.assets || path.join(args.game, "assets")
      ),
      srcRoot: path.resolve(
        process.cwd(),
        args.src || path.join(args.game, "client")
      ),
      outputRoot: path.resolve(process.cwd(), args.output),
      event: (e: any) => editor?.emit("event", e),
    };

    const editor = args.production
      ? null
      : new EditorServerHost(
          args.port + 1,
          path.join(buildContext.gameRoot, "editor", "server"),
          buildContext.outputRoot
        );

    if (!editor) {
      console.log(
        `${chalk.dim("[editor]")} ${chalk.red("Disabled in production builds")}`
      );
    }


    const success = await executeBuildPlugins(
      buildContext,
      await loadBuildPlugins(
        args.customPlugins ? args.build || path.join(args.game, "build") : null,
        args.plugins
      )
    );

    console.log();
    console.log(
      success
        ? chalk.green("Build complete")
        : chalk.red("Build completed with errors")
    );

    watchTypescript(buildContext.gameRoot);
  },
};

const cleanCommand = {
  command: "clean",
  describe: "Cleans all built game output",
  builder: (yargs: Argv<CommonBuildOptions>) => yargs,

  handler: async (args: CommonBuildOptions) => {
    const buildContext = {
      production: false,
      port: PORT,
      clean: true,
      build: false,
      watch: false,
      gameRoot: path.resolve(process.cwd(), args.game),
      assetRoot: path.resolve(
        process.cwd(),
        args.assets || path.join(args.game, "assets")
      ),
      srcRoot: path.resolve(
        process.cwd(),
        args.src || path.join(args.game, "client")
      ),
      outputRoot: path.resolve(process.cwd(), args.output),
      event: () => {},
    };

    // build game assets
    await executeBuildPlugins(
      buildContext,
      await loadBuildPlugins(
        args.customPlugins ? args.build || path.join(args.game, "build") : null,
        args.plugins
      )
    );
  },
};

Promise.resolve(
  yargs(hideBin(process.argv))
    .option("game", {
      type: "string",
      default: ".",
    })
    .option("assets", {
      type: "string",
      hidden: true,
    })
    .option("src", {
      type: "string",
      hidden: true,
    })
    .option("build", {
      type: "string",
      hidden: true,
    })
    .option("customPlugins", {
      type: "boolean",
      hidden: true,
      flag: true,
      default: true,
    })
    .option("output", {
      type: "string",
      required: true,
    })
    .option("plugins", {
      type: "string",
      array: true,
    })
    .option("production", {
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
      if (msg) {
        console.log(msg);
      }
      console.log(err);
      process.exit(1);
    }).argv
);

async function loadBuildPlugins(
  customPluginsRoot: string | null,
  filter: Array<string> | undefined
): Promise<Array<LoadedBuildPlugin>> {
  const plugins: Array<LoadedBuildPlugin> = [];
  const pluginRoots = [path.join(dirname, "plugins")];
  if (customPluginsRoot) {
    pluginRoots.push(customPluginsRoot);
  }

  for (const r of pluginRoots) {
    const pluginFiles = await fs.readdir(r);
    for (const p of pluginFiles) {
      if (p.indexOf(".d.ts") > -1) {
        continue;
      }
      const pluginName = p.replace(path.extname(p), "");
      if (!filter || filter.includes(pluginName)) {
        const pluginPath = path.join(r, p);
        const plugin = await import(pluginPath);
        plugins.push({
          name: pluginName,
          plugin: new plugin.default() as BuildPlugin,
        });
      }
    }
  }
  return topologicalSort(plugins);
}

function topologicalSort(
  plugins: Array<LoadedBuildPlugin>
): Array<LoadedBuildPlugin> {
  const edges = new Map<string, LoadedBuildPlugin>();
  plugins.forEach((p) => edges.set(p.name, p));

  const sorted: LoadedBuildPlugin[] = [];
  const visited = new Set<string>();
  const temp = new Set<string>();

  const visit = (p: LoadedBuildPlugin, stack: Set<string>) => {
    if (visited.has(p.name)) return;
    if (stack.has(p.name)) {
      throw new Error(`Circular dependency detected: ${p.name}`);
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
}

async function executeBuildPlugins(
  ctx: Omit<BuildContext, "log" | "onError">,
  plugins: Array<LoadedBuildPlugin>
): Promise<boolean> {
  if (ctx.clean) {
    try {
      await fs.rm(ctx.outputRoot);
    } catch (e) {}
  }

  let errors = 0;
  for (const plugin of plugins) {
    const pluginCtx = {
      ...ctx,
      log: (message: string) => {
        console.log(chalk.dim(`[${plugin.name}]`), message);
      },
      onError: (error: string) => {
        if (!ctx.watch) {
          throw new Error(error);
        } else {
          ++errors;
          console.log(chalk.dim(`[${plugin.name}]`), chalk.red(error));
        }
      },
    };
    if (ctx.clean) {
      await plugin.plugin.clean(pluginCtx);
    }
    if (ctx.build && (await plugin.plugin.init(pluginCtx))) {
      try {
        await plugin.plugin.build(pluginCtx, !ctx.clean);
      } catch (e) {
        console.log(
          chalk.dim(`[${plugin.name}]`),
          chalk.red((e as Error).message)
        );
        throw e;
      }
      if (ctx.watch) {
        await plugin.plugin.watch(pluginCtx, watcher.subscribe);
      }
    }
  }
  return errors === 0;
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
