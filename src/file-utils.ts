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

export function getStringHash(content: string): string {
  const hash = createHash("sha256");
  hash.update(content);
  return hash.digest("hex");
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

export async function loadJson(file: string): Promise<
  | {
      ok: true;
      data: any;
    }
  | {
      ok: false;
    }
> {
  try {
    return { ok: true, data: JSON.parse(await fs.promises.readFile(file, "utf8")) };
  } catch (ex) {
    return { ok: false };
  }
}
