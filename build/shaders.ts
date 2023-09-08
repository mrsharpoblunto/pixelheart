import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import fs from "fs/promises";
import chalk from "chalk";
import { shadersPath, shadersSrcPath, isShader, processShader } from "./shader-utils";
import { ensurePath } from "./sprite-utils";

Promise.resolve(
  yargs(hideBin(process.argv)).scriptName("build-shaders").usage("$0 args").argv
).then(async (_args) => {
  await ensurePath(shadersSrcPath);

  const shaders = await fs.readdir(shadersPath);
  for (let shader of shaders) {
    if (!isShader(shader)) {
      continue;
    }
    await processShader(
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
});
