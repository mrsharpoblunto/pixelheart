import Game from "./client";

export function createGameClient() {
  return new Game();
}

export function createEditorClient() {
  if (process.env.NODE_ENV === "development") {
    const Editor = require("./editor/client").default;
    return new Editor();
  } else {
    return null;
  }
}
