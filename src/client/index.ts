import GameRunner from "./game-runner";
import { onSave, onStart, onUpdate, onDraw } from "./game";

const gameCanvas = GameRunner({
  fixedUpdate: 1000 / 60,
  saveKey: "pixelheart",
  save: onSave,
  start: onStart,
  update: onUpdate,
  draw: onDraw,
  screen: { width: 320, height: 208 },
  offscreenCanvas: { width: 1024, height: 1024 },
});

if (gameCanvas) {
  const root = document.getElementById("root");
  root?.appendChild(gameCanvas);
}
