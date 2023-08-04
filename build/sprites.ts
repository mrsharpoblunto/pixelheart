import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import fs from "fs/promises";
import path from "path";
import watcher from "@parcel/watcher";
import sharp from "sharp";

const spritePath = path.join(__dirname, "../sprites");
const wwwPath = path.join(__dirname, "../www/sprites");
const srcPath = path.join(__dirname, "../src/sprites");
const spriteRegex = /([a-zA-Z_][a-zA-Z0-9_]*)-([0-9]+)x([0-9]+)\.png/;

Promise.resolve(
  yargs(hideBin(process.argv))
    .scriptName("build-sprites")
    .usage("$0 args")
    .option("watch", {
      alias: "w",
      type: "boolean",
      description: "Enable watch mode",
    }).argv
).then(async (args) => {
  await ensurePath(wwwPath);
  await ensurePath(srcPath);

  if (!args.watch) {
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
  } else {
    const sourceSpriteSheets = await fs.readdir(spritePath);
    const destSpriteSheets = await fs.readdir(wwwPath);

    // on first run, check if any sprites are missing or older
    // than the source and build them
    for (const src of sourceSpriteSheets) {
      const srcStat = await fs.stat(path.join(spritePath, src));
      const dest = `${src}.png`;
      if (destSpriteSheets.find((d) => d === dest)) {
        const destStat = await fs.stat(path.join(wwwPath, dest));
        if (srcStat.mtimeMs > destStat.mtimeMs) {
          await processSpriteSheet(src, console.error);
        }
      } else {
        await processSpriteSheet(src, console.error);
      }
    }

    // then await other changes as they come
    await watcher.subscribe(spritePath, async (_err, events) => {
      await processSpriteSheetEvents(events);
    });
  }
});

interface Sprite {
  width: number;
  height: number;
  frames: Array<{
    top: number;
    left: number;
    bottom: number;
    right: number;
  }>;
}

async function ensurePath(pathName: string) {
  try {
    await fs.mkdir(pathName, { recursive: true });
  } catch (ex) {
    if ((ex as NodeJS.ErrnoException).code !== "EEXIST") {
      throw ex;
    }
  }
}

async function processSpriteSheetEvents(events: watcher.Event[]) {
  const newOrModified = new Set<string>();
  const deleted = [];
  for (let e of events) {
    const components = e.path.substring(spritePath.length + 1).split("/");
    switch (e.type) {
      case "create":
      case "update":
        {
          // if the spritesheet or a png has been added/changed. We ignore
          // other stuff because image editing apps can create tmp files while saving etc..
          if (components.length === 1 || path.extname(e.path) === ".png") {
            newOrModified.add(components[0]);
          }
        }
        break;

      case "delete":
        {
          // if its a toplevel spritesheet directory, remove the spritesheet
          // if its a sprite in a sheet, modify the spritesheet
          if (components.length === 1) {
            console.log(`Removing ${components[0]}...`);
            deleted.push(components[0]);
          } else if (path.extname(e.path) === ".png") {
            newOrModified.add(components[0]);
          }
        }
        break;
    }
  }

  for (let d of deleted) {
    try {
      await fs.rm(path.join(srcPath, `${d}.ts`));
      await fs.rm(path.join(wwwPath, `${d}.png`));
    } catch (ex) {}
  }

  for (let nom of newOrModified) {
    await processSpriteSheet(nom, console.error);
  }
}

async function processSpriteSheet(
  spriteSheet: string,
  showError: (error: string) => void
): Promise<void> {
  console.log(`Building ${spriteSheet}...`);

  const spriteImages: Array<{ name: string; image: Buffer }> = [];
  const sheetMapping: {
    [key: string]: Sprite;
  } = {};
  let sheetHeight = 0;
  let sheetWidth = 0;

  const sprites = await fs.readdir(path.join(spritePath, spriteSheet));
  for (let sprite of sprites) {
    console.log(`Processing ${spriteSheet}:${sprite}...`);
    const result = spriteRegex.exec(sprite);
    if (!result) {
      showError(`Invalid sprite format: ${sprite}`);
    } else {
      const name = result[1];
      const width = parseInt(result[2], 10);
      const height = parseInt(result[3], 10);
      const image = sharp(path.join(spritePath, spriteSheet, sprite));
      let metadata: { width?: number; height?: number } = {};
      try {
        metadata = await image.metadata();
      } catch (ex) {}

      if (metadata.width && metadata.height) {
        if (metadata.width !== width && metadata.width % width !== 0) {
          showError(
            `Invalid sprite width ${metadata.width}, must be a multiple of ${width}`
          );
        }
        if (metadata.height !== height) {
          showError(
            `Invalid sprite width ${metadata.height}, must be equal to ${height}`
          );
        }
        spriteImages.push({ name, image: await image.toBuffer() });
        const sprite: Sprite = {
          width,
          height,
          frames: [],
        };
        for (let i = 0; i < metadata.width / width; ++i) {
          sprite.frames.push({
            top: sheetHeight,
            left: i * width,
            bottom: sheetHeight + height,
            right: (i + 1) * width,
          });
        }
        sheetMapping[name] = sprite;
        sheetWidth = Math.max(sheetWidth, metadata.width);
        sheetHeight += metadata.height;
      } else {
        showError("Invalid sprite metadata");
      }
    }
  }

  await fs.writeFile(
    path.join(srcPath, `${spriteSheet}.ts`),
    `const Sheet = { 
  sprites: {
` +
      Object.keys(sheetMapping)
        .map(
          (sprite) => `   ${sprite}: ${JSON.stringify(sheetMapping[sprite])},`
        )
        .join("\n") +
      `
  },
  url: "./sprites/${spriteSheet}.png"
};
export default Sheet;`
  );

  if (sheetWidth && sheetHeight) {
    const combined = sharp({
      create: {
        width: sheetWidth,
        height: sheetHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    });

    await combined
      .composite(
        spriteImages.map(({ name, image }) => ({
          input: image,
          top: sheetMapping[name].frames[0].top,
          left: sheetMapping[name].frames[0].left,
        }))
      )
      .toFile(path.join(wwwPath, `${spriteSheet}.png`));
  }

  console.log(`Completed ${spriteSheet}.\n`);
}
