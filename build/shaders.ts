import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import fs from "fs/promises";
import chalk from "chalk";
import { shadersPaths, isShader, processShader } from "./shader-utils";
import { ensurePath } from "./common-utils";

Promise.resolve(
  yargs(hideBin(process.argv)).scriptName("build-shaders").usage("$0 args").argv
).then(async (_args) => {

  for (let shaderPath of shadersPaths) {
  await ensurePath(shaderPath.src);
  const shaders = await fs.readdir(shaderPath.assets);
  for (let shader of shaders) {
    if (!isShader(shader)) {
      continue;
    }
    await processShader(
      shaderPath,
      shader,
      true,
      (message: string) => {
        console.log(chalk.dim("[Shaders]"), message);
      },
      (error: string) => {
        console.log(chalk.dim("[Shaders]"), chalk.red(error));
        throw new Error(error);
      }
    );
  }
  }
});
