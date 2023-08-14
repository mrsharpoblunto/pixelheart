import { parentPort } from "worker_threads";
import { EditorAction } from "../shared/editor-actions";
import path from "path";
import sharp from "sharp";

if (parentPort) {
  console.log("Editor: Running.");
  parentPort.on("message", async (message: any) => {
    const workingImages = new Map<
      string,
      {
        width: number;
        height: number;
        channels: sharp.Channels;
        buffer: Buffer;
      }
    >();

    // process the editor action
    for (let a of message.actions as Array<EditorAction>) {
      console.log(`Editor: processing ${a.type} action`);
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

    for (const [imagePath, image] of workingImages.entries()) {
      await sharp(image.buffer, {
        raw: {
          width: image.width!,
          height: image.height!,
          channels: image.channels!,
        },
      })
        .png()
        .toFile(imagePath);
    }

    if (message.requestId) {
      parentPort!.postMessage({
        requestId: message.requestId,
        response: {},
      });
    }
  });
}
