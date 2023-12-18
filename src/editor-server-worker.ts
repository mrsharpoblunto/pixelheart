import { parentPort } from "worker_threads";

import { EditorActions, EditorEvents } from "../game";
import EditorServer from "../game/editor/server";
import { ServerWorkerEditorConnection } from "./editor-connections";

if (parentPort) {
  // editor server sends events and receives actions, the opposite to the
  // client
  const connection = new ServerWorkerEditorConnection<
    EditorEvents,
    EditorActions
  >(parentPort);
  new EditorServer(connection);
}
