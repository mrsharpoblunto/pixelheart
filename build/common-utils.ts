import fs from "fs";
import {createHash} from "crypto";

export async function getFileHash(file: string) : Promise<string> {
  const hash = createHash("sha256");
  const stream = fs.createReadStream(file);
  stream.on("data", (chunk) => hash.update(chunk));
  await new Promise((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}
