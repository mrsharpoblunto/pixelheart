import React from 'react';
import GameRunner from './game-runner';
import {onInit, onUpdate, onDraw} from './game';

export const App: React.FC = () => {
  return (
    <div>
      <GameRunner fixedUpdate={1000/60} init={onInit} update={onUpdate} draw={onDraw}  />
    </div>
  );
};

