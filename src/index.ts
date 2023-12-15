import Game from "../game/client";
import GameRunner from "./game-runner";

const root = document.getElementById("root");
if (root) {
  const props = {
    fixedUpdate: 1000 / 60,
    saveKey: "pixelheart",
    game: new Game(),
    editor: null,
    editorSocket: null,
    screen: {
      incrementSize: 16,
      preferredWidthIncrements: 20,
      preferredHeightIncrements: 13,
    },
    container: root,
  };

  if (process.env.NODE_ENV === "development") {
    const socket = new WebSocket(
      `ws://${window.location.hostname}:${
        parseInt(window.location.port, 10) + 2
      }`
    );
    socket.addEventListener("open", () => {
      console.info("Connected to editor WebSocket");
      const Editor = require("../game/editor/client").default;
      GameRunner({ ...props, editor: new Editor(), editorSocket: socket });
    });
  } else {
    GameRunner(props);
  }
}
