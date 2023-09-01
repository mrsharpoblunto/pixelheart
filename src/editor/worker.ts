import { parentPort } from "worker_threads";
import { EditorAction } from "../shared/editor-actions";
import path from "path";
import sharp from "sharp";
import chalk from "chalk";

const log = (message: string) => {
  console.log(chalk.dim("[Editor]"), message);
};

const logError = (message: string) => {
  console.log(chalk.dim("[Editor]"), chalk.red(message));
};

if (parentPort) {
  log("Running.");

  const workingImages = new Map<
    string,
    {
      width: number;
      height: number;
      channels: sharp.Channels;
      buffer: Buffer;
    }
  >();

  setInterval(() => {
    for (const [imagePath, image] of workingImages.entries()) {
      sharp(image.buffer, {
        raw: {
          width: image.width!,
          height: image.height!,
          channels: image.channels!,
        },
      })
        .png()
        .toFile(imagePath)
        .then(() => {
          log(`Saved updated image to ${imagePath}`);
        })
        .catch((err) => {
          logError(
            `Failed to save updated image to ${imagePath} - ${err.toString()}`
          );
        });
    }
    workingImages.clear();
  }, 2000);

  parentPort.on("message", async (message: any) => {
    // process the editor action
    let actionCount = 1;
    let previousAction = null;
    for (let a of message.actions as Array<EditorAction>) {
      if (previousAction === a.type) {
        actionCount++;
      } else {
        if (previousAction !== null) {
          log(`Processing ${actionCount} ${chalk.green(a.type)} action(s)`);
        }
        previousAction = a.type;
        actionCount = 1;
      }

      switch (a.type) {
        case "TILE_CHANGE":
          {
            const imagePath = path.join(
              __dirname,
              "../../www/images/walkmap.png"
            );
            let existing = workingImages.get(imagePath);
            if (!existing) {
              const image = sharp(imagePath);
              const metadata = await image.metadata();
              existing = {
                width: metadata.width!,
                height: metadata.height!,
                channels: metadata.channels!,
                buffer: await image.raw().toBuffer(),
              };
              workingImages.set(imagePath, existing);
            }
            existing.buffer[
              (a.x + a.y * existing.width!) * existing.channels!
            ] = a.value;
          }
          break;
        case "RESTART":
          process.exit(0);
        default:
          throw new Error("Unknown Editor action");
      }
    }
    if (previousAction) {
      log(`Processing ${actionCount} ${chalk.green(previousAction)} action(s)`);
    }

    if (message.requestId) {
      parentPort!.postMessage({
        requestId: message.requestId,
        response: {},
      });
    }
  });
}
