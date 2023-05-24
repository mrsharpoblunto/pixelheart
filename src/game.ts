import {RenderContext} from './game-runner';
import {CPUReadableTexture, loadCPUReadableTexture} from './images';
import SpriteEffect from './sprite-effect';


export interface GameState {
  spriteEffect: SpriteEffect,
  map: CPUReadableTexture,
};

export async function onInit(ctx: RenderContext): Promise<GameState> {
  return {
    spriteEffect: new SpriteEffect(ctx.gl),
    map: await loadCPUReadableTexture(ctx,  '/images/overworld.png'),
  };
}

export function onDraw(ctx: RenderContext, state: GameState, delta: number) {
  state.spriteEffect.bind().setTexture(state.map.texture).draw();
}

export function onUpdate(ctx: RenderContext, state: GameState, fixedDelta: number): Promise<void> {
}
