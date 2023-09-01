import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import fs from "fs/promises";
import chalk from "chalk";
import {
  spritePath,
  wwwPath,
  spriteSrcPath,
  ensurePath,
  processSpriteSheet,
} from "./sprite-utils";

Promise.resolve(
  yargs(hideBin(process.argv)).scriptName("build-sprites").usage("$0 args").argv
).then(async (_args) => {
  await ensurePath(wwwPath);
  await ensurePath(spriteSrcPath);

  const spriteSheets = await fs.readdir(spritePath);
  for (let spriteSheet of spriteSheets) {
    await processSpriteSheet(
      spriteSheet,
      (message: string) => {
        console.log(chalk.dim("[Sprites]"), message);
      },
      (error: string) => {
        console.log(chalk.dim("[Sprites]"), chalk.red(error));
        throw new Error(error);
      }
    );
  }
});
