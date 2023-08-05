import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import fs from "fs/promises";
import {
  spritePath,
  wwwPath,
  srcPath,
  ensurePath,
  processSpriteSheet,
} from "./sprite-utils";

Promise.resolve(
  yargs(hideBin(process.argv)).scriptName("build-sprites").usage("$0 args").argv
).then(async (args) => {
  await ensurePath(wwwPath);
  await ensurePath(srcPath);

  const spriteSheets = await fs.readdir(spritePath);
  for (let spriteSheet of spriteSheets) {
    await processSpriteSheet(spriteSheet, (error: string) => {
      if (!args.watch) {
        throw new Error(error);
      } else {
        console.error(error);
      }
    });
  }
});
