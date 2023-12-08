import { GameContext } from "./game-runner";
import { vec4, vec3, ReadonlyVec2 } from "gl-matrix";
import { loadCPUReadableTextureFromUrl } from "./images";
import { loadSpriteSheet } from "./sprite-common";
import {
  deferredTextureLoader,
  DeferredSpriteSheet,
  DeferredSpriteAnimator,
  DeferredSpriteEffect,
} from "./deferred-sprite-effect";
import {
  SimpleSpriteEffect,
  SimpleSpriteSheet,
  simpleTextureLoader,
} from "./sprite-effect";
import { WaterEffect } from "./water-effect";
import { NearestBlurEffect } from "./nearest-blur";
import { SolidEffect } from "./solid-effect";
import overworldMap from "../shared/generated/maps/overworld";
import characterSprite from "../shared/generated/sprites/character";
import uiSprite from "../shared/generated/sprites/ui";
import { MapTile, MapTileSource } from "../shared/map-format";
import * as coords from "./coordinates";
import { vec2 } from "gl-matrix";
import { EditorAction } from "../shared/editor-actions";
import MapData from "./map";

const CONTROLLER_DEADZONE = 0.25;
const TOUCH_DEADZONE = 5;
const CURRENT_SERIALIZATION_VERSION = 2;
const MAX_TIME = 1000;

export interface SerializedGameState {
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
  map: MapData;
  overworld: DeferredSpriteSheet;
  ui: SimpleSpriteSheet;
  character: {
    sprite: DeferredSpriteSheet;
    animator: DeferredSpriteAnimator;
    position: vec2;
    relativePosition: vec2;
    speed: number;
    boundingBox: vec4;
  };
  screen: {
    absolutePosition: vec2;
  };
  animationTimer: number;
  waterEffect: WaterEffect;
  blurEffect: NearestBlurEffect;
  editor?: EditorState;
  moveTouch: { id: number; startPosition: ReadonlyVec2 } | null;
}

export interface EditorState {
  active: boolean;
  newValue: string | null;
  queued: Array<EditorAction>;
  pending: Array<EditorAction>;
  isUpdating: boolean;
}

export function onSave(state: GameState): SerializedGameState {
  return {
    version: CURRENT_SERIALIZATION_VERSION,
    character: {
      position: [state.character.position[0], state.character.position[1]],
      direction: state.character.animator.getSpriteName(),
    },
  };
}

export async function onStart(
  ctx: GameContext,
  previousState?: SerializedGameState
): Promise<GameState> {
  if (
    previousState &&
    previousState.version !== CURRENT_SERIALIZATION_VERSION
  ) {
    // if its possible to gracefully handle loading a previous version, do so
    // otherwise, throw an error
    throw new Error(`Invalid save version ${previousState.version}`);
  }

  const overworld = await loadSpriteSheet(
    ctx,
    overworldMap.spriteSheet,
    deferredTextureLoader
  );
  const character = await loadSpriteSheet(
    ctx,
    characterSprite,
    deferredTextureLoader
  );
  const map = await loadCPUReadableTextureFromUrl(ctx, overworldMap.url);

  const state: GameState = {
    spriteEffect: new DeferredSpriteEffect(ctx.gl),
    simpleSpriteEffect: new SimpleSpriteEffect(ctx.gl),
    solidEffect: new SolidEffect(ctx.gl),
    map: new MapData(ctx, coords.TILE_SIZE, map),
    ui: await loadSpriteSheet(ctx, uiSprite, simpleTextureLoader),
    overworld: overworld,
    character: {
      sprite: character,
      animator: new DeferredSpriteAnimator(
        character,
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
        character.walk_u.height - 14,
        character.walk_u.width - 2,
        character.walk_u.height - 4,
        2
      ),
      speed: 1,
    },
    waterEffect: new WaterEffect(ctx.gl),
    blurEffect: new NearestBlurEffect(ctx.gl),
    animationTimer: 0,
    screen: {
      absolutePosition: vec2.create(),
    },
    moveTouch: null,
  };

  if (process.env.NODE_ENV === "development") {
    state.editor = {
      active: false,
      newValue: null,
      queued: [],
      pending: [],
      isUpdating: false,
    };
    setInterval(() => {
      if (!state.editor) {
        return;
      }
      pushEdits(state.editor);
    }, 1000);
  }

  return state;
}

function pushEdits(editor: EditorState) {
  if (editor.queued.length && !editor.isUpdating) {
    fetch("/edit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(editor.queued),
    })
      .then((r) => {
        if (!r.ok) {
          throw new Error("Network response was not ok");
        }
        return r.json();
      })
      .then((_data) => {
        editor.pending = [];
        editor.isUpdating = false;
      })
      .catch((_err) => {
        // re-queue events that failed
        editor.queued = editor.pending.concat(editor.queued);
        editor.pending = [];
        editor.isUpdating = false;
      });
    editor.pending = editor.queued;
    editor.queued = [];
  }
}

export function onUpdate(
  ctx: GameContext,
  state: GameState,
  fixedDelta: number
) {
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
      state.moveTouch = { id: k, startPosition: vec2.clone(v.position) };
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
    state.character.animator.setSpriteOrTick(newDirection, fixedDelta);
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
  vec2.scale(movement, movement, state.character.speed);
  vec2.add(movement, movement, state.character.position);

  const renderOffset = vec2.fromValues(
    state.character.animator.getSprite().width / 2,
    state.character.animator.getSprite().height / 2
  );

  // check the characters bounding box against the map
  // top left
  const isWalkable =
    state.map.read(
      Math.floor(
        (movement[0] - renderOffset[0] + state.character.boundingBox[3]) /
          coords.TILE_SIZE
      ),
      Math.floor(
        (movement[1] - renderOffset[1] + state.character.boundingBox[0]) /
          coords.TILE_SIZE
      )
    ).walkable &&
    // top right
    state.map.read(
      Math.floor(
        (movement[0] - renderOffset[0] + state.character.boundingBox[1]) /
          coords.TILE_SIZE
      ),
      Math.floor(
        (movement[1] - renderOffset[1] + state.character.boundingBox[0]) /
          coords.TILE_SIZE
      )
    ).walkable &&
    // bottom left
    state.map.read(
      Math.floor(
        (movement[0] - renderOffset[0] + state.character.boundingBox[3]) /
          coords.TILE_SIZE
      ),
      Math.floor(
        (movement[1] - renderOffset[1] + state.character.boundingBox[2]) /
          coords.TILE_SIZE
      )
    ).walkable &&
    // bottom right
    state.map.read(
      Math.floor(
        (movement[0] - renderOffset[0] + state.character.boundingBox[1]) /
          coords.TILE_SIZE
      ),
      Math.floor(
        (movement[1] - renderOffset[1] + state.character.boundingBox[2]) /
          coords.TILE_SIZE
      )
    ).walkable;

  if (isWalkable) {
    const renderOffset = vec2.fromValues(
      state.character.animator.getSprite().width / 2,
      state.character.animator.getSprite().height / 2
    );
    const mapSize = vec2.fromValues(
      state.map.width * coords.TILE_SIZE,
      state.map.height * coords.TILE_SIZE
    );
    vec2.subtract(mapSize, mapSize, renderOffset);
    vec2.min(state.character.position, movement, mapSize);
    vec2.max(state.character.position, state.character.position, renderOffset);
  }

  // character position relative to the top left of the screen
  state.character.relativePosition[0] =
    state.character.position[0] < ctx.screen.width / 2
      ? state.character.position[0]
      : state.character.position[0] >
        state.map.width * coords.TILE_SIZE - ctx.screen.width / 2
      ? state.character.position[0] -
        state.map.width * coords.TILE_SIZE +
        ctx.screen.width
      : ctx.screen.width / 2;
  state.character.relativePosition[1] =
    state.character.position[1] < ctx.screen.height / 2
      ? state.character.position[1]
      : state.character.position[1] >
        state.map.height * coords.TILE_SIZE - ctx.screen.height / 2
      ? state.character.position[1] -
        state.map.height * coords.TILE_SIZE +
        ctx.screen.height
      : ctx.screen.height / 2;

  // Record the scroll offset of the screen
  vec2.subtract(
    state.screen.absolutePosition,
    state.character.position,
    state.character.relativePosition
  );

  state.map.updateScreenBuffer(ctx, state.screen.absolutePosition);

  if (process.env.NODE_ENV === "development") {
    updateEditor(ctx, state, fixedDelta);
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  x = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

export function onDraw(ctx: GameContext, state: GameState, delta: number) {
  ctx.gl.enable(ctx.gl.BLEND);
  ctx.gl.blendFunc(ctx.gl.SRC_ALPHA, ctx.gl.ONE_MINUS_SRC_ALPHA);

  const ssp = coords.toAbsoluteTileFromAbsolute(
    vec4.create(),
    state.screen.absolutePosition
  );

  let sin = Math.sin(state.animationTimer);
  sin = Math.min(1.0, sin + 0.5);

  const day =
    state.animationTimer < MAX_TIME * 0.25
      ? smoothstep(0, MAX_TIME * 0.25, state.animationTimer)
      : state.animationTimer < MAX_TIME * 0.5
      ? 1.0
      : state.animationTimer < MAX_TIME * 0.75
      ? 1.0 - smoothstep(MAX_TIME * 0.5, MAX_TIME * 0.75, state.animationTimer)
      : 0.0;
  const sunDirection = Math.cos(
    (Math.min(state.animationTimer, MAX_TIME * 0.75) * Math.PI) /
      (MAX_TIME * 0.75)
  );

  state.spriteEffect
    .addDirectionalLight({
      ambient: vec3.fromValues(
        0.2 + day * 0.3,
        0.2 + day * 0.3,
        0.4 + day * 0.1
      ),
      direction: vec3.fromValues(sunDirection, day * 0.3 + 0.2, -1.0),
      diffuse: vec3.fromValues(
        Math.pow(day, 0.25) * (1 - day) + day * 0.5,
        day * 0.5,
        day * 0.45
      ),
    })
    .addDirectionalLight({
      ambient: vec3.create(),
      direction: vec3.fromValues(0.0, (1 - day) * 0.5, -1.0),
      diffuse: vec3.fromValues(
        (1 - day) * 0.2,
        (1 - day) * 0.2,
        (1 - day) * 0.2
      ),
    })
    .addPointLight({
      diffuse: vec3.fromValues(
        0.6 * (1 - day),
        0.6 * (1 - day),
        0.3 * (1 - day)
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
        if (pass === 0) {
          // overdraw the screen by 1 tile at each edge to prevent tile pop-in
          for (
            let x = -1;
            x <= (ctx.screen.width + 2) / coords.TILE_SIZE;
            ++x
          ) {
            for (
              let y = -1;
              y <= (ctx.screen.height + 2) / coords.TILE_SIZE;
              ++y
            ) {
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

              const tile = state.map.read(mapX, mapY);
              if (tile.index !== 0) {
                const tileName = overworldMap.spriteSheet.indexes[tile.index];
                state.overworld[tileName].draw(
                  s,
                  position,
                  tile.spatialHash ? hash(mapX, mapY) : undefined
                );
              }
            }
          }
        } else {
          const offset = vec2.fromValues(
            state.character.animator.getSprite().width / 2,
            state.character.animator.getSprite().height / 2
          );

          state.character.animator.draw(
            s,
            ctx.screen.toScreenSpace(
              vec4.create(),
              vec4.fromValues(
                Math.floor(state.character.relativePosition[1]) - offset[1],
                Math.floor(state.character.relativePosition[0]) + offset[0],
                Math.floor(state.character.relativePosition[1]) + offset[1],
                Math.floor(state.character.relativePosition[0]) - offset[0]
              )
            )
          );
        }
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
        vec4.fromValues(1.0, 1.0, 0, 0),
        vec4.fromValues(0, lightingTexture.width, lightingTexture.height, 0)
      );
    }

    if (state.moveTouch !== null) {
      s.setAlpha(0.5);
      state.ui.touch.draw(
        s,
        ctx.screen.toScreenSpace(
          vec4.create(),
          vec4.fromValues(
            Math.round(state.moveTouch.startPosition[1]) - 32,
            Math.round(state.moveTouch.startPosition[0]) + 32,
            Math.round(state.moveTouch.startPosition[1]) + 32,
            Math.round(state.moveTouch.startPosition[0]) - 32
          )
        )
      );
    }
  });

  if (process.env.NODE_ENV === "development") {
    drawEditor(ctx, state, delta);
  }
}

const edgeTileSuffixes = new Set<string>();
edgeTileSuffixes.add("tl");
edgeTileSuffixes.add("tr");
edgeTileSuffixes.add("bl");
edgeTileSuffixes.add("br");
edgeTileSuffixes.add("t");
edgeTileSuffixes.add("b");
edgeTileSuffixes.add("l");
edgeTileSuffixes.add("r");
edgeTileSuffixes.add("i_tl");
edgeTileSuffixes.add("i_tr");
edgeTileSuffixes.add("i_bl");
edgeTileSuffixes.add("i_br");

function updateEditor(ctx: GameContext, state: GameState, _fixedDelta: number) {
  if (!state.editor) return;

  if (ctx.keys.pressed.has("m") && ctx.keys.down.has("Control")) {
    state.editor.active = !state.editor.active;
  }

  if (!state.editor.active) {
    return;
  }

  if (ctx.mouse.down[0]) {
    const ap = coords.pickAbsoluteTileFromRelative(
      vec4.create(),
      ctx.mouse.position,
      state.screen
    );

    if (state.editor.newValue === null) {
      const oldValue = state.map.read(ap[0], ap[1]);
      const oldSprite = overworldMap.spriteSheet.indexes[oldValue.index];
      state.editor.newValue = oldSprite === "" ? "grass" : "";
    }

    queueTileChange(state.editor.newValue, ap[0], ap[1], state);
  } else {
    state.editor.newValue = null;
  }
}

function queueTileChange(
  newValue: string,
  x: number,
  y: number,
  state: GameState
) {
  createPendingChange(newValue, x, y, state);

  const toRecheck = new Array<{
    x: number;
    y: number;
    sprite: string;
  }>();

  // reset all adjacent edge tiles to their base sprite
  for (let offsetX = -1; offsetX <= 1; ++offsetX) {
    for (let offsetY = -1; offsetY <= 1; ++offsetY) {
      const tile = state.map.read(x + offsetX, y + offsetY);
      const sprite = overworldMap.spriteSheet.indexes[tile.index];
      const splitIndex = sprite.indexOf("_");
      if (splitIndex !== -1) {
        const baseSprite = sprite.substring(0, splitIndex);
        const spriteSuffix = sprite.substring(splitIndex + 1);
        if (
          overworldMap.spriteSheet.sprites.hasOwnProperty(baseSprite) &&
          edgeTileSuffixes.has(spriteSuffix)
        ) {
          const index =
            overworldMap.spriteSheet.sprites[
              baseSprite as keyof typeof overworldMap.spriteSheet.sprites
            ].index;
          tile.index = index;
          createPendingChange(baseSprite, x + offsetX, y + offsetY, state);
          toRecheck.push({
            x: x + offsetX,
            y: y + offsetY,
            sprite: baseSprite,
          });
        }
      } else {
        toRecheck.push({ x: x + offsetX, y: y + offsetY, sprite });
      }
    }
  }

  const newEdges = Array<{
    x: number;
    y: number;
    sprite: string;
  }>();

  // convert any tiles that should be to edges (if a suitable sprite exists)
  for (let check of toRecheck) {
    const top = state.map.read(check.x, check.y - 1).index === 0;
    const left = state.map.read(check.x - 1, check.y).index === 0;
    const bottom = state.map.read(check.x, check.y + 1).index === 0;
    const right = state.map.read(check.x + 1, check.y).index === 0;
    const topLeft = state.map.read(check.x - 1, check.y - 1).index === 0;
    const topRight = state.map.read(check.x + 1, check.y - 1).index === 0;
    const bottomLeft = state.map.read(check.x - 1, check.y + 1).index === 0;
    const bottomRight = state.map.read(check.x + 1, check.y + 1).index === 0;

    if (top && left) {
      newEdges.push({ x: check.x, y: check.y, sprite: check.sprite + "_tl" });
    } else if (top && right) {
      newEdges.push({ x: check.x, y: check.y, sprite: check.sprite + "_tr" });
    } else if (top && !left && !right) {
      newEdges.push({ x: check.x, y: check.y, sprite: check.sprite + "_t" });
    } else if (topLeft && !left && !top) {
      newEdges.push({ x: check.x, y: check.y, sprite: check.sprite + "_i_tl" });
    } else if (topRight && !right && !top) {
      newEdges.push({ x: check.x, y: check.y, sprite: check.sprite + "_i_tr" });
    } else if (left && !top && !bottom) {
      newEdges.push({ x: check.x, y: check.y, sprite: check.sprite + "_l" });
    } else if (bottom && left) {
      newEdges.push({ x: check.x, y: check.y, sprite: check.sprite + "_bl" });
    } else if (bottom && right) {
      newEdges.push({ x: check.x, y: check.y, sprite: check.sprite + "_br" });
    } else if (bottom && !left && !right) {
      newEdges.push({ x: check.x, y: check.y, sprite: check.sprite + "_b" });
    } else if (bottomLeft && !left && !bottom) {
      newEdges.push({ x: check.x, y: check.y, sprite: check.sprite + "_i_bl" });
    } else if (bottomRight && !right && !bottom) {
      newEdges.push({ x: check.x, y: check.y, sprite: check.sprite + "_i_br" });
    } else if (right && !top && !bottom) {
      newEdges.push({ x: check.x, y: check.y, sprite: check.sprite + "_r" });
    }
  }

  for (let edge of newEdges) {
    if (overworldMap.spriteSheet.sprites.hasOwnProperty(edge.sprite)) {
      createPendingChange(edge.sprite, edge.x, edge.y, state);
    }
  }
}

function createPendingChange(
  sprite: string,
  x: number,
  y: number,
  state: GameState
) {
  const found = rfind(
    state.editor!.queued,
    (e) => e.type === "TILE_CHANGE" && e.x === x && e.y === y
  );

  const sourceValue =
    found && found.type === "TILE_CHANGE"
      ? found.value
      : (() => {
          const change: EditorAction = {
            type: "TILE_CHANGE",
            x: x,
            y: y,
            map: "overworld",
            value: {
              sprite: "",
              animated: false,
              walkable: false,
              triggerId: 0,
              spatialHash: false,
            },
          };
          state.editor!.queued.push(change);
          return change.value;
        })();

  Object.assign(sourceValue, {
    sprite,
    animated: false,
    walkable: sprite !== "",
    triggerId: 0,
    spatialHash: sprite !== "",
  });

  const index =
    sprite === ""
      ? 0
      : overworldMap.spriteSheet.sprites[
          sprite as keyof typeof overworldMap.spriteSheet.sprites
        ].index;
  state.map.write(x, y, { ...sourceValue, index });
}

function rfind<T>(
  arr: Array<T>,
  predicate: (value: T, index: number, arr: Array<T>) => boolean
): T | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i], i, arr)) {
      return arr[i];
    }
  }
  return null;
}

function drawEditor(ctx: GameContext, state: GameState, _delta: number) {
  if (!state.editor) return;

  if (state.editor.active) {
    const ap = coords.pickAbsoluteTileFromRelative(
      vec4.create(),
      ctx.mouse.position,
      state.screen
    );

    state.solidEffect.use((s) => {
      // editor cursor
      s.draw(
        coords.toScreenSpaceFromAbsoluteTile(vec4.create(), ap, {
          ...state.screen,
          ...ctx.screen,
        }),
        vec4.fromValues(1.0, 0, 0, 0.5)
      );

      // character bounding box
      const offset = vec2.fromValues(
        state.character.animator.getSprite().width / 2,
        state.character.animator.getSprite().height / 2
      );
      s.draw(
        ctx.screen.toScreenSpace(
          vec4.create(),
          vec4.fromValues(
            Math.floor(state.character.relativePosition[1]) -
              offset[1] +
              state.character.boundingBox[0],
            Math.floor(state.character.relativePosition[0]) -
              offset[0] +
              state.character.boundingBox[1],
            Math.floor(state.character.relativePosition[1]) -
              offset[1] +
              state.character.boundingBox[2],
            Math.floor(state.character.relativePosition[0]) -
              offset[0] +
              state.character.boundingBox[3]
          )
        ),
        vec4.fromValues(0.0, 0, 1.0, 0.5)
      );
    });
  }
}

function hash(x: number, y: number): number {
  const A = 48271;
  const M = 2147483647;
  const Q = M / A;
  const R = M % A;

  let temp = A * (x % Q) - R * Math.floor(x / Q);
  if (temp >= 0) x = temp;
  else x = temp + M;

  temp = A * (y % Q) - R * Math.floor(y / Q);
  if (temp >= 0) y = temp;
  else y = temp + M;

  return x ^ y;
}
