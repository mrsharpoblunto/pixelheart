import fs from "fs";

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
