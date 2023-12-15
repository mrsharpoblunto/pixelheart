import { createHash } from "crypto";
import fs from "fs";

export async function getFileHash(file: string): Promise<string> {
  try {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    await new Promise((resolve, reject) => {
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    return hash.digest("hex");
  } catch (ex: any) {
    if (ex.code === "ENOENT") {
      return "";
    }
    throw ex;
  }
}

export async function ensurePath(pathName: string) {
  try {
    await fs.promises.mkdir(pathName, { recursive: true });
  } catch (ex) {
    if ((ex as NodeJS.ErrnoException).code !== "EEXIST") {
      throw ex;
    }
  }
}
