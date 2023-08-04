import React from "react";
import GameRunner from "./game-runner";
import { onStart, onSave, onUpdate, onDraw } from "./game";

export const App: React.FC = () => {
  return (
    <div>
      <GameRunner
        fixedUpdate={1000 / 60}
        saveKey="pixelheart"
        save={onSave}
        start={onStart}
        update={onUpdate}
        draw={onDraw}
      />
    </div>
  );
};
