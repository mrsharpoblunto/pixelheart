import yargs, { boolean } from "yargs";
import { hideBin } from "yargs/helpers";

import { processStatic } from "./static-utils";

Promise.resolve(
  yargs(hideBin(process.argv)).scriptName("build-sprites").usage("$0 args").argv
).then(async (_args) => {
  await processStatic(true);
});
