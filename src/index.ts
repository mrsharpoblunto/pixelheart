import GameRunner from "./game-runner";
import Game from "../game/client";
import Editor from "../game/editor/client";

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
    let running = false;
    socket.addEventListener("open", () => {
      console.info("Connected to editor WebSocket");
      running = true;
      GameRunner({ ...props, editor: new Editor(), editorSocket: socket });
    });
    socket.addEventListener("close", (error: any) => {
      if (!running) {
        console.warn(
          "Editor Websocket disconnected: Starting up without editor support",
          error
        );
        GameRunner(props);
      } else {
        console.error("Editor Websocket disconnected", error);
      }
    });
  } else {
    GameRunner(props);
  }
}
