import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import fs from "fs/promises";
import chalk from "chalk";
import path from "path";
import { getFileHash } from "./common-utils";

export const wwwPath = path.join(__dirname, "..", "www");

Promise.resolve(
  yargs(hideBin(process.argv)).scriptName("build-sprites").usage("$0 args").argv
).then(async (_args) => {
  const html = await fs.readFile(
    path.join(__dirname, "..", "src", "index.html"),
    "utf-8"
  );

  const srcOrLinkRegex = /(src|href)="([^"]+)"/g;

  // find all the matches for this regex in the html
  const matches = html.matchAll(srcOrLinkRegex);
  const hashes = new Map<string, string>();
  for (let m of matches) {
    if (!m[2].startsWith("data:")) {
      const filePath = path.join(wwwPath, m[2]);
      hashes.set(m[2], await getFileHash(filePath));
    }
  }

  const updatedHtml = html.replaceAll(srcOrLinkRegex, (match, attr, url) => {
    const hash = hashes.get(url);
    if (hash) {
      console.log(
        `${chalk.dim("[Html]")} Updating asset link ${url} -> ${url}?v=${hash}`
      );
      return `${attr}="${url}?v=${hash}"`;
    } else {
      return match;
    }
  });

  await fs.writeFile(path.join(wwwPath, "index.html"), updatedHtml);
});
