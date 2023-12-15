import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import fs from "fs/promises";
import chalk from "chalk";
import path from "path";
import { mapsPath, wwwPath, mapSrcPath, processMap } from "./map-utils";
import { ensurePath } from "./common-utils";

Promise.resolve(
  yargs(hideBin(process.argv)).scriptName("build-maps").usage("$0 args").argv
).then(async (_args) => {
  await ensurePath(wwwPath);
  await ensurePath(mapSrcPath);

  const maps = await fs.readdir(mapsPath);
  for (let map of maps) {
    const stat = await fs.stat(path.join(mapsPath, map));
    if (stat.isFile()) {
      continue;
    }
    await processMap(
      map,
      (message: string) => {
        console.log(chalk.dim("[Maps]"), message);
      },
      (error: string) => {
        console.log(chalk.dim("[Maps]"), chalk.red(error));
        throw new Error(error);
      }
    );
  }
});
