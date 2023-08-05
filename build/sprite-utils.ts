import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

export const spritePath = path.join(__dirname, "../sprites");
export const wwwPath = path.join(__dirname, "../www/sprites");
export const srcPath = path.join(__dirname, "../src/sprites");

const spriteRegex = /([a-zA-Z_][a-zA-Z0-9_]*)-([0-9]+)x([0-9]+)\.png/;

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

export async function ensurePath(pathName: string) {
  try {
    await fs.mkdir(pathName, { recursive: true });
  } catch (ex) {
    if ((ex as NodeJS.ErrnoException).code !== "EEXIST") {
      throw ex;
    }
  }
}

export async function processSpriteSheet(
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
