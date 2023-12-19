import { parentPort } from "worker_threads";

import EditorServer from "../game/editor/server";
import { ServerWorkerEditorConnection } from "./editor-connections";

if (parentPort) {
  // editor server sends events and receives actions, the opposite to the
  // client
  new EditorServer(new ServerWorkerEditorConnection(parentPort));
}
