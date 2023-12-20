import GameRunner from "./game-runner";

const root = document.getElementById("root");
if (root) {
  // @ts-ignore
  const gamePlugin = import(window.__PIXELHEART_GAME_PLUGIN_URL__);
  gamePlugin.then((plugin) => {
    const props = {
      fixedUpdate: 1000 / 60,
      saveKey: "pixelheart",
      game: plugin.createGameClient,
      editor: plugin.createEditorClient,
      screen: {
        incrementSize: 16,
        preferredWidthIncrements: 20,
        preferredHeightIncrements: 13,
      },
      container: root,
    };

    GameRunner(props);
  });
}
