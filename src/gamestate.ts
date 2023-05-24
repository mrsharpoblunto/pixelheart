import {CPUReadableTexture} from './images';

interface PlayerState {
  direction: 'up' | 'down' | 'left' | 'right',
  x: number,
  y: number,
}

interface OverworldMap {
  tileset: WebGLTexture,
  layers: CPUReadableTexture,
}

interface GameState {
  player: PlayerState,
  map: OverworldMap,
}


