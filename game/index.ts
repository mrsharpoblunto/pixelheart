import { entrypoint } from "@pixelheart/client";

export function createGameClient() {
  return new (require("./client").default)();
}

export function createEditorClient() {
  if (process.env.NODE_ENV === "development") {
    const Editor = require("./editor/client").default;
    return new Editor();
  } else {
    return null;
  }
}

entrypoint(createGameClient, createEditorClient);
