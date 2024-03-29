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
import { ensurePath } from "./file-utils.js";
import { EditorServerHost } from "@pixelheart/server";
import { Logger } from "./logger.js";
import { BuildContext, BuildPlugin } from "./plugin.js";

export type { BuildContext, BuildPlugin } from "./plugin.js";

const PORT = 8000;
const dirname = path.dirname(url.fileURLToPath(import.meta.url));


interface LoadedBuildPlugin {
  name: string;
  plugin: BuildPlugin;
}

interface CommonBuildOptions {
  production: boolean;
  clean: boolean;
  "game-path": string;
  "game-asset-path": string | undefined;
  "game-client-path": string | undefined;
  "game-build-path": string | undefined;
  "game-output-path": string;
  "custom-build-plugins": boolean;
  "build-plugin-filter": Array<string> | undefined;
}

interface BuildOptions extends CommonBuildOptions {
  serve: boolean;
  watch: boolean;
  port: number;
}

interface RunOptions extends CommonBuildOptions {
  port: number;
}

interface SerializedBuildOptions {
  production: boolean;
}

interface BuildContextArgs {
  production: boolean,
  clean: boolean,
  build: boolean,
  watch: boolean | { port: number },
  "game-path": string,
  "game-asset-path": string | undefined,
  "game-client-path": string | undefined,
  "game-build-path": string | undefined,
  "game-output-path": string,
  eventEmitter?: EventEmitter,
}

class BuildContextImpl extends Logger implements BuildContext {
  #eventEmitter: EventEmitter | undefined;
  #buildInfoPath: string;
  readonly production: boolean;
  readonly clean: boolean;
  readonly build: boolean;
  readonly watch: boolean | { port: number };
  readonly gamePath: string;
  readonly gameAssetPath: string;
  readonly gameClientPath: string;
  readonly gameBuildPath: string;
  readonly gameEditorClientPath: string;
  readonly gameEditorServerPath: string;
  readonly gameOutputPath: string;

  constructor(args: BuildContextArgs) {
    super(!args.watch);
    this.#eventEmitter = args.eventEmitter;
    this.production = args.production;
    this.clean = args.clean;
    this.build = args.build;
    this.watch = args.watch;
    this.gamePath = path.resolve(process.cwd(), args["game-path"]);
    this.gameAssetPath = path.resolve(
      process.cwd(),
      args["game-asset-path"] || path.join(args["game-path"], "assets")
    );
    this.gameClientPath = path.resolve(
      process.cwd(),
      args["game-client-path"] || path.join(args["game-path"], "client")
    );
    this.gameBuildPath = path.resolve(
      process.cwd(),
      args["game-build-path"] || path.join(args["game-path"], "build")
    );
    this.gameEditorClientPath = path.resolve(
      process.cwd(),
      path.join(args["game-path"], "editor", "client")
    );
    this.gameEditorServerPath = path.resolve(
      process.cwd(),
      path.join(args["game-path"], "editor", "server")
    );
    this.gameOutputPath = path.resolve(process.cwd(), args["game-output-path"]);

    // if the previous build had different settings, invalidate
    // any previously built assets by forcing a clean build
    this.#buildInfoPath = path.join(this.gamePath, ".pixelbuildinfo");
    if (existsSync(this.#buildInfoPath)) {
      try {
        const previousBuildInfo = require(this.#buildInfoPath) as SerializedBuildOptions;
        if (previousBuildInfo.production !== this.production) {
          this.clean = true;
        }
      } catch (ex) {
      }
    }
  }

  emit(e: any) {
    this.#eventEmitter?.emit("event", e);
  }

  async execute(
    useCustomBuildPlugins: boolean,
    pluginFilter: Array<string> | undefined,
  ): Promise<boolean> {
    if (!existsSync(this.gamePath)) {
      this.warn("build", `Game path ${this.gamePath} does not exist`);
      return false;
    }

    const plugins = await this.#loadPlugins(
      useCustomBuildPlugins ? this.gameBuildPath : null,
      pluginFilter,
    );

    for (const plugin of plugins) {
      if (this.clean) {
        await plugin.plugin.clean(this);
      }
      if (this.build && (await plugin.plugin.init(this))) {
        try {
          await plugin.plugin.build(this);
        } catch (e) {
          this.error(plugin.name, (e as Error).message);
        }
        if (this.watch) {
          await plugin.plugin.watch(this, watcher.subscribe);
        }
      }
    }

    await ensurePath(this.gameOutputPath);
    await fs.writeFile(this.#buildInfoPath, JSON.stringify({
      production: this.production,
    }));

    return this.errorCount === 0;
  }

  async #loadPlugins(
    customBuildPluginsPath: string | null,
    filter: Array<string> | undefined
  ): Promise<Array<LoadedBuildPlugin>> {
    const plugins: Array<LoadedBuildPlugin> = [];
    const pluginRoots = [path.join(dirname, "plugins")];
    if (customBuildPluginsPath) {
      if (!existsSync(customBuildPluginsPath)) {
        this.warn("build", `Custom build plugins path ${customBuildPluginsPath} does not exist`);
      } else {
        pluginRoots.push(customBuildPluginsPath);
      }
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
    return this.#topologicalSort(plugins);
  }


  #topologicalSort(
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
      this.error("build", e.message);
      return plugins;
    }
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
      .option("watch", {
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
      build: true,
    });

    const success = await buildContext.execute(
      args["custom-build-plugins"],
      args["build-plugin-filter"],
    );

    buildContext.log("build");
    if (success) {
      buildContext.warn("build", `Build completed with ${buildContext.errorCount} error(s)`);
    } else {
      buildContext.log("build", chalk.green("Build complete"));
    }

    if (args.serve) {
      const app = express();
      app.use(compression());
      app.use(express.static(buildContext.gameOutputPath));
      app.listen(args.port, () => {
        buildContext.log("server");
        buildContext.log("server", `Running at http://localhost:${args.port}`);
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
        args.port + 1);

    const buildContext = new BuildContextImpl({
      ...args,
      build: true,
      watch: { port: args.port },
      eventEmitter: editor
    });

    const success = await buildContext.execute(
      args["custom-build-plugins"],
      args["build-plugin-filter"],
    );

    if (!editor) {
      buildContext.warn("editor", "Disabled in production builds");
    } else {
      editor.start(
        buildContext.gameEditorServerPath,
        buildContext.gameOutputPath,
      );
    }

    buildContext.log("build");
    if (!success) {
      buildContext.warn("build", `Build completed with ${buildContext.errorCount} error(s)`);
    } else {
      buildContext.log("build", chalk.green("Build complete"));
    }
    buildContext.log("build");

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

    await buildContext.execute(
      args["custom-build-plugins"],
      args["build-plugin-filter"],
    );
  },
};

Promise.resolve(
  yargs(hideBin(process.argv))
    .option("game-path", {
      type: "string",
      default: ".",
      alias: "g",
    })
    .option("build-plugin-filter", {
      type: "string",
      array: true,
      alias: "plugins",
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
    .option("game-output-path", {
      type: "string",
      required: true,
      alias: "o",
    })
    .option("game-asset-path", {
      type: "string",
      hidden: true,
    })
    .option("game-client-path", {
      type: "string",
      hidden: true,
    })
    .option("game-build-path", {
      type: "string",
      hidden: true,
    })
    .option("custom-build-plugins", {
      type: "boolean",
      hidden: true,
      flag: true,
      default: true,
    })
    .command(buildCommand)
    .command(runCommand)
    .command(cleanCommand)
    .demandCommand(1)
    .strict()
    .scriptName("pixelheart")
    .usage("$0 <cmd> args")
    .fail((msg, err, _yargs) => {
      if (err && !(err as any).scope) {
        console.log();
        console.log('Unhandled Exception:');
        console.log(chalk.red(err));
      } else if (msg) {
        console.log(chalk.red(msg));
      }
      process.exit(1);
    }).argv
);

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
