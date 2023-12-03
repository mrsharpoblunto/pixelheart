import GameRunner from "./game-runner";
import { onSave, onStart, onUpdate, onDraw } from "./game";

const gameCanvas = GameRunner({
  fixedUpdate: 1000 / 60,
  saveKey: "pixelheart",
  save: onSave,
  start: onStart,
  update: onUpdate,
  draw: onDraw,
  screen: {
    incrementSize: 16,
    preferredWidthIncrements: 20,
    preferredHeightIncrements: 13,
  },
});

if (gameCanvas) {
  const root = document.getElementById("root");
  root?.appendChild(gameCanvas);
}
