import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import fs from "fs/promises";
import chalk from "chalk";
import path from "path";
import { isShader, processShaderTypeDefinition } from "./shader-utils";

const shaderSrcPath = path.join(__dirname, "..", "src", "client", "shaders");
Promise.resolve(
  yargs(hideBin(process.argv)).scriptName("build-shaders").usage("$0 args").argv
).then(async (_args) => {
  const shaders = await fs.readdir(shaderSrcPath);
  for (let shader of shaders) {
    if (!isShader(shader)) {
      continue;
    }
    await processShaderTypeDefinition(
      path.join(shaderSrcPath, shader),
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
