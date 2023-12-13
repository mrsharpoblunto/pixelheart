import GameRunner from "./game-runner";
import { onSave, onStart, onUpdate, onDraw } from "./game";
import { onMount } from "./editor";

function createGame(socket: WebSocket | null) {
  return GameRunner({
    fixedUpdate: 1000 / 60,
    saveKey: "pixelheart",
    save: onSave,
    start: onStart,
    update: onUpdate,
    draw: onDraw,
    editorSocket: socket,
    screen: {
      incrementSize: 16,
      preferredWidthIncrements: 20,
      preferredHeightIncrements: 13,
    },
  });
}

const root = document.getElementById("root");
if (root) {
  if (process.env.NODE_ENV === "development") {
    const socket = new WebSocket(
      `ws://${window.location.hostname}:${
        parseInt(window.location.port, 10) + 2
      }`
    );
    let mounted = false;
    socket.addEventListener("open", () => {
      console.info("Connected to editor WebSocket");
      mounted = true;
      onMount(createGame(socket)!, root);
    });
    socket.addEventListener("close", (error: any) => {
      if (!mounted) {
        console.warn("Editor Websocket disconnected: Starting up without editor support", error);
        root.appendChild(createGame(null)!.canvas);
      } else {
        console.error("Editor Websocket disconnected", error);
      }
    });
  } else {
    root.appendChild(createGame(null)!.canvas);
  }
}
