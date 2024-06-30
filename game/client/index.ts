import {
  GameClient,
  GameContext,
  MapContainer,
  ResourceLoader,
  coords,
  loadMapContainer,
  loadSpriteSheet,
  math
} from "@pixelheart/client";
import { ReadonlyVec2, vec2, vec3, vec4 } from "@pixelheart/client/gl-matrix";
import {
  DeferredSpriteAnimator,
  DeferredSpriteEffect,
  DeferredSpriteSheet,
  DeferredSpriteTextures,
  SimpleSpriteEffect,
  SimpleSpriteSheet,
  SolidEffect,
  deferredTextureLoader,
  simpleTextureLoader,
} from "@pixelheart/effects";

import overworldMap from "./maps/overworld.js";
import { NearestBlurEffect } from "./nearest-blur.js";
import characterSprite from "./sprites/character.js";
import uiSprite from "./sprites/ui.js";
import { WaterEffect } from "./water-effect.js";

const CONTROLLER_DEADZONE = 0.25;
const TOUCH_DEADZONE = 5;
const CURRENT_SERIALIZATION_VERSION = 2;
const MAX_TIME = 1000;

export interface PersistentState {
  version: number;
  character: {
    position: [number, number];
    direction: string;
  };
}

export interface GameState {
  spriteEffect: DeferredSpriteEffect;
  simpleSpriteEffect: SimpleSpriteEffect;
  solidEffect: SolidEffect;
  resources: ResourceLoader<{
    ui: SimpleSpriteSheet;
    map: MapContainer<DeferredSpriteTextures>;
    character: {
      sprite: DeferredSpriteSheet;
      animator: DeferredSpriteAnimator;
      position: vec2;
      relativePosition: vec2;
      speed: number;
      boundingBox: vec4;
    };
  }>;
  screen: {
    absolutePosition: vec2;
  };
  animationTimer: number;
  waterEffect: WaterEffect;
  blurEffect: NearestBlurEffect;
  moveTouch: { id: number; startPosition: ReadonlyVec2 } | null;
  directionalLighting: Array<{
    ambient: vec3;
    direction: vec3;
    diffuse: vec3;
  }>;
  day: number;
}

export default class Game implements GameClient<GameState, PersistentState> {
  constructor() { }

  onStart(ctx: GameContext, previousState?: PersistentState): GameState {
    if (
      previousState &&
      previousState.version !== CURRENT_SERIALIZATION_VERSION
    ) {
      // if its possible to gracefully handle loading a previous version, do so
      // otherwise, throw an error
      throw new Error(`Invalid save version ${previousState.version}`);
    }

    const state: GameState = {
      spriteEffect: new DeferredSpriteEffect(ctx),
      simpleSpriteEffect: new SimpleSpriteEffect(ctx),
      solidEffect: new SolidEffect(ctx),
      resources: new ResourceLoader({
        ui: loadSpriteSheet(ctx, uiSprite, simpleTextureLoader),
        map: loadMapContainer(
          ctx,
          coords.TILE_SIZE,
          overworldMap,
          deferredTextureLoader
        ),
        character: (async () => {
          const c = await loadSpriteSheet(
            ctx,
            characterSprite,
            deferredTextureLoader
          );
          return {
            sprite: c,
            animator: new DeferredSpriteAnimator(
              c,
              previousState ? previousState.character.direction : "walk_d",
              8 / 1000
            ),
            position: previousState
              ? vec2.fromValues(
                previousState.character.position[0],
                previousState.character.position[1]
              )
              : vec2.fromValues(
                overworldMap.startPosition.x * coords.TILE_SIZE,
                overworldMap.startPosition.y * coords.TILE_SIZE
              ),
            relativePosition: vec2.create(),
            boundingBox: vec4.fromValues(
              c.walk_u.height - 14,
              c.walk_u.width - 2,
              c.walk_u.height - 4,
              2
            ),
            speed: 1,
          };
        })(),
      }),

      waterEffect: new WaterEffect(ctx),
      blurEffect: new NearestBlurEffect(ctx),
      animationTimer: 0,
      screen: {
        absolutePosition: vec2.create(),
      },
      moveTouch: null,
      directionalLighting: [],
      day: 0,
    };

    return state;
  }

  onSave(state: GameState): PersistentState | null {
    let result = null;
    state.resources.ifReady((r) => {
      result = {
        version: CURRENT_SERIALIZATION_VERSION,
        character: {
          position: [r.character.position[0], r.character.position[1]],
          direction: r.character.animator.getSpriteName(),
        },
      };
    });
    return result;
  }

  onUpdate(ctx: GameContext, state: GameState, fixedDelta: number) {
    state.resources.ifReady((r) => {
      const direction: { [key: string]: boolean } = {};

      // gamepad input
      const gp = ctx.getGamepad();
      if (gp) {
        if (
          gp.buttons[12].pressed ||
          Math.min(0.0, gp.axes[1] + CONTROLLER_DEADZONE) < 0
        ) {
          direction.up = true;
        }
        if (
          gp.buttons[13].pressed ||
          Math.max(0.0, gp.axes[1] - CONTROLLER_DEADZONE) > 0
        ) {
          direction.down = true;
        }
        if (
          gp.buttons[14].pressed ||
          Math.min(0.0, gp.axes[0] + CONTROLLER_DEADZONE) < 0
        ) {
          direction.left = true;
        }
        if (
          gp.buttons[15].pressed ||
          Math.max(0.0, gp.axes[0] - CONTROLLER_DEADZONE) > 0
        ) {
          direction.right = true;
        }
      }

      // keyboard input
      if (ctx.keys.pressed.has("f") && ctx.keys.down.has("Control")) {
        if (!document.fullscreenElement) {
          ctx.canvas.requestFullscreen();
        } else if (document.exitFullscreen) {
          document.exitFullscreen();
        }
      }
      if (ctx.keys.down.has("w") || ctx.keys.down.has("ArrowUp")) {
        direction.up = true;
      }
      if (ctx.keys.down.has("s") || ctx.keys.down.has("ArrowDown")) {
        direction.down = true;
      }
      if (ctx.keys.down.has("a") || ctx.keys.down.has("ArrowLeft")) {
        direction.left = true;
      }
      if (ctx.keys.down.has("d") || ctx.keys.down.has("ArrowRight")) {
        direction.right = true;
      }

      // touch input
      for (let [k, v] of ctx.touches.down) {
        if (state.moveTouch === null && Date.now() - v.started > 250) {
          state.moveTouch = {
            id: k,
            startPosition: vec2.clone(v.position),
          };
        }
      }
      for (let [k, _] of ctx.touches.ended) {
        if (state.moveTouch !== null && k === state.moveTouch.id) {
          state.moveTouch = null;
        }
      }
      if (state.moveTouch !== null) {
        const currentTouch = ctx.touches.down.get(state.moveTouch.id);
        if (currentTouch) {
          if (
            currentTouch.position[0] - state.moveTouch.startPosition[0] <
            -TOUCH_DEADZONE
          ) {
            direction.left = true;
          }
          if (
            currentTouch.position[0] - state.moveTouch.startPosition[0] >
            TOUCH_DEADZONE
          ) {
            direction.right = true;
          }
          if (
            currentTouch.position[1] - state.moveTouch.startPosition[1] <
            -TOUCH_DEADZONE
          ) {
            direction.up = true;
          }
          if (
            currentTouch.position[1] - state.moveTouch.startPosition[1] >
            TOUCH_DEADZONE
          ) {
            direction.down = true;
          }
        } else {
          state.moveTouch = null;
        }
      }

      let newDirection: keyof typeof characterSprite.sprites | null = null;
      // direction animations are mutually exclusive
      if (direction.left) {
        newDirection = "walk_l";
      } else if (direction.right) {
        newDirection = "walk_r";
      } else if (direction.up) {
        newDirection = "walk_u";
      } else if (direction.down) {
        newDirection = "walk_d";
      }

      if (newDirection) {
        r.character.animator.setSpriteOrTick(newDirection, fixedDelta);
      }

      // provide a stable looping animation
      state.animationTimer += fixedDelta / 10;
      if (state.animationTimer > MAX_TIME) {
        state.animationTimer -= MAX_TIME;
      }

      // but movement is not
      const movement = vec2.create();
      if (direction.left) {
        movement[0]--;
      }
      if (direction.right) {
        movement[0]++;
      }
      if (direction.up) {
        movement[1]--;
      }
      if (direction.down) {
        movement[1]++;
      }
      // make sure angular movement isn't faster than up/down/left/right
      vec2.normalize(movement, movement);
      vec2.scale(movement, movement, r.character.speed);
      vec2.add(movement, movement, r.character.position);

      const renderOffset = vec2.fromValues(
        r.character.animator.getSprite().width / 2,
        r.character.animator.getSprite().height / 2
      );

      // check the characters bounding box against the map
      // top left
      const isWalkable =
        r.map.data.read(
          Math.floor(
            (movement[0] - renderOffset[0] + r.character.boundingBox[3]) /
            coords.TILE_SIZE
          ),
          Math.floor(
            (movement[1] - renderOffset[1] + r.character.boundingBox[0]) /
            coords.TILE_SIZE
          )
        ).walkable &&
        // top right
        r.map.data.read(
          Math.floor(
            (movement[0] - renderOffset[0] + r.character.boundingBox[1]) /
            coords.TILE_SIZE
          ),
          Math.floor(
            (movement[1] - renderOffset[1] + r.character.boundingBox[0]) /
            coords.TILE_SIZE
          )
        ).walkable &&
        // bottom left
        r.map.data.read(
          Math.floor(
            (movement[0] - renderOffset[0] + r.character.boundingBox[3]) /
            coords.TILE_SIZE
          ),
          Math.floor(
            (movement[1] - renderOffset[1] + r.character.boundingBox[2]) /
            coords.TILE_SIZE
          )
        ).walkable &&
        // bottom right
        r.map.data.read(
          Math.floor(
            (movement[0] - renderOffset[0] + r.character.boundingBox[1]) /
            coords.TILE_SIZE
          ),
          Math.floor(
            (movement[1] - renderOffset[1] + r.character.boundingBox[2]) /
            coords.TILE_SIZE
          )
        ).walkable;

      if (isWalkable) {
        const renderOffset = vec2.fromValues(
          r.character.animator.getSprite().width / 2,
          r.character.animator.getSprite().height / 2
        );
        const mapSize = vec2.fromValues(
          r.map.data.width * coords.TILE_SIZE,
          r.map.data.height * coords.TILE_SIZE
        );
        vec2.subtract(mapSize, mapSize, renderOffset);
        vec2.min(r.character.position, movement, mapSize);
        vec2.max(r.character.position, r.character.position, renderOffset);
      }

      // character position relative to the top left of the screen
      r.character.relativePosition[0] =
        r.character.position[0] < ctx.screen.width / 2
          ? r.character.position[0]
          : r.character.position[0] >
            r.map.data.width * coords.TILE_SIZE - ctx.screen.width / 2
            ? r.character.position[0] -
            r.map.data.width * coords.TILE_SIZE +
            ctx.screen.width
            : ctx.screen.width / 2;
      r.character.relativePosition[1] =
        r.character.position[1] < ctx.screen.height / 2
          ? r.character.position[1]
          : r.character.position[1] >
            r.map.data.height * coords.TILE_SIZE - ctx.screen.height / 2
            ? r.character.position[1] -
            r.map.data.height * coords.TILE_SIZE +
            ctx.screen.height
            : ctx.screen.height / 2;

      // Record the scroll offset of the screen
      vec2.subtract(
        state.screen.absolutePosition,
        r.character.position,
        r.character.relativePosition
      );

      r.map.data.updateScreenBuffer(ctx, state.screen.absolutePosition);
    });

    let sin = Math.sin(state.animationTimer);
    sin = Math.min(1.0, sin + 0.5);

    state.day =
      state.animationTimer < MAX_TIME * 0.25
        ? math.smoothstep(0, MAX_TIME * 0.25, state.animationTimer)
        : state.animationTimer < MAX_TIME * 0.5
          ? 1.0
          : state.animationTimer < MAX_TIME * 0.75
            ? 1.0 -
            math.smoothstep(
              MAX_TIME * 0.5,
              MAX_TIME * 0.75,
              state.animationTimer
            )
            : 0.0;
    const sunDirection = Math.cos(
      (Math.min(state.animationTimer, MAX_TIME * 0.75) * Math.PI) /
      (MAX_TIME * 0.75)
    );

    state.directionalLighting = [
      {
        ambient: vec3.fromValues(
          0.2 + state.day * 0.3,
          0.2 + state.day * 0.3,
          0.4 + state.day * 0.1
        ),
        direction: vec3.fromValues(sunDirection, state.day * 0.3 + 0.2, -1.0),
        diffuse: vec3.fromValues(
          Math.pow(state.day, 0.25) * (1 - state.day) + state.day * 0.5,
          state.day * 0.5,
          state.day * 0.45
        ),
      },
      {
        ambient: vec3.create(),
        direction: vec3.fromValues(0.0, (1 - state.day) * 0.5, -1.0),
        diffuse: vec3.fromValues(
          (1 - state.day) * 0.2,
          (1 - state.day) * 0.2,
          (1 - state.day) * 0.2
        ),
      },
    ];
  }

  onDraw(ctx: GameContext, state: GameState, _delta: number) {
    ctx.gl.enable(ctx.gl.BLEND);
    ctx.gl.blendFunc(ctx.gl.SRC_ALPHA, ctx.gl.ONE_MINUS_SRC_ALPHA);

    const ssp = coords.toAbsoluteTileFromAbsolute(
      vec4.create(),
      state.screen.absolutePosition
    );

    for (const l of state.directionalLighting) {
      state.spriteEffect.addDirectionalLight(l);
    }
    state.spriteEffect
      .addPointLight({
        diffuse: vec3.fromValues(
          0.6 * (1 - state.day),
          0.6 * (1 - state.day),
          0.3 * (1 - state.day)
        ),
        position: vec3.fromValues(
          ctx.mouse.position[0] / ctx.screen.width,
          ctx.mouse.position[1] / ctx.screen.height,
          0.1
        ),
        radius: 0.5,
      })
      .use(
        {
          width: ctx.screen.width,
          height: ctx.screen.height,
        },
        (s, pass) => {
          state.resources.ifReady((r) => {
            const tileWidth =
              (ctx.screen.width + 2 * coords.TILE_SIZE) / coords.TILE_SIZE;
            const tileHeight =
              (ctx.screen.height + 2 * coords.TILE_SIZE) / coords.TILE_SIZE;
            if (pass === 0) {
              // overdraw the screen by 1 tile at each edge to prevent tile pop-in
              for (let x = -1; x <= tileWidth; ++x) {
                for (let y = -1; y <= tileHeight; ++y) {
                  const mapX = x + ssp[0];
                  const mapY = y + ssp[1];

                  const position = ctx.screen.toScreenSpace(
                    vec4.create(),
                    vec4.fromValues(
                      y * coords.TILE_SIZE - ssp[3],
                      x * coords.TILE_SIZE + coords.TILE_SIZE - ssp[2],
                      y * coords.TILE_SIZE + coords.TILE_SIZE - ssp[3],
                      x * coords.TILE_SIZE - ssp[2]
                    )
                  );

                  const tile = r.map.data.read(mapX, mapY);
                  if (tile.index !== 0) {
                    const tileName = r.map.spriteConfig.indexes[tile.index];
                    r.map.sprite[tileName].draw(
                      s,
                      position,
                      tile.spatialHash ? math.hash(mapX, mapY) : undefined
                    );
                  }
                }
              }
            } else {
              const offset = vec2.fromValues(
                r.character.animator.getSprite().width / 2,
                r.character.animator.getSprite().height / 2
              );

              r.character.animator.draw(
                s,
                ctx.screen.toScreenSpace(
                  vec4.create(),
                  vec4.fromValues(
                    Math.floor(r.character.relativePosition[1]) - offset[1],
                    Math.floor(r.character.relativePosition[0]) + offset[0],
                    Math.floor(r.character.relativePosition[1]) + offset[1],
                    Math.floor(r.character.relativePosition[0]) - offset[0]
                  )
                )
              );
            }
          });
        },
        (mask) => {
          const pos = vec2.clone(state.screen.absolutePosition);
          vec2.div(
            pos,
            pos,
            vec2.fromValues(ctx.screen.width, ctx.screen.height)
          );
          state.blurEffect.draw(mask, 3.0);
          state.waterEffect.draw(
            state.animationTimer,
            pos,
            ctx.screen,
            mask,
            state.blurEffect.getBlurTexture()
          );
        }
      );

    // draw the accumulated deferred lighting texture to the screen
    state.simpleSpriteEffect.use((s) => {
      const lightingTexture = state.spriteEffect.getLightingTexture();
      if (lightingTexture) {
        s.setTextures(lightingTexture);
        s.draw(
          vec4.fromValues(0.0, 1.0, 1.0, 0.0),
          vec4.fromValues(0, lightingTexture.width, lightingTexture.height, 0)
        );
      }

      if (state.moveTouch !== null) {
        const moveTouch = state.moveTouch;
        s.setAlpha(0.5);
        state.resources.ifReady((r) => {
          r.ui.touch.draw(
            s,
            ctx.screen.toScreenSpace(
              vec4.create(),
              vec4.fromValues(
                Math.round(moveTouch.startPosition[1]) - 32,
                Math.round(moveTouch.startPosition[0]) + 32,
                Math.round(moveTouch.startPosition[1]) + 32,
                Math.round(moveTouch.startPosition[0]) - 32
              )
            )
          );
        });
      }
    });
  }
}
