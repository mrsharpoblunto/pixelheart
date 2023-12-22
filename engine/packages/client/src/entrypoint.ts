import GameRunner from "./game-runner.js";

export function createGameClient() {
  // @ts-ignore
  return new (require(process.env.GAME_CLIENT).default)();
}

export function createEditorClient() {
  if (process.env.NODE_ENV === "development") {
    // @ts-ignore
    return new (require(process.env.GAME_EDITOR).default)();
  } else {
    return null;
  }
}

// @ts-ignore
if (!window.__PIXELHEART__) {
  // @ts-ignore
  window.__PIXELHEART__ = true;
  const root = document.getElementById("root");
  if (root) {
    // @ts-ignore
    const props = {
      fixedUpdate: 1000 / 60,
      saveKey: "pixelheart",
      // @ts-ignore
      game: createGameClient(),
      editor: createEditorClient(),
      screen: {
        incrementSize: 16,
        preferredWidthIncrements: 20,
        preferredHeightIncrements: 13,
      },
      container: root,
    };
    GameRunner(props);
  }
}

