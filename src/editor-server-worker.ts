import path from "path";
import { parentPort } from "worker_threads";

import EditorServer from "../game/editor/server";
import { ServerWorkerEditorConnection } from "./editor-connections";

if (parentPort) {
  // editor server sends events and receives actions, the opposite to the
  // client
  new EditorServer(
    {
      outputRoot: path.join(__dirname, "..", "www"),
      gameRoot: path.join(__dirname, "..", "game"),
      assetsRoot: path.join(__dirname, "..", "game", "assets"),
  generatedSrcRoot: path.join(__dirname, "..", "game", "client", "generated"),
    },
    new ServerWorkerEditorConnection(parentPort)
  );
}
