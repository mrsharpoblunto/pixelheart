import GameRunner from "./game-runner";

export function entrypoint(
  createGameClient: () => any,
  createEditorClient: () => any
) {
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
        game: createGameClient,
        editor: createEditorClient,
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
}
