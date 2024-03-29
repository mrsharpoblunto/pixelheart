import { Root, createRoot } from "react-dom/client";

import {
  BaseActions,
  BaseEvents,
  EditorClient,
  EditorContext,
  MapContainer,
  MapTileSource,
  SpriteSheet,
  TEXTURE,
  coords,
  loadSpriteSheetSync,
} from "@pixelheart/client";
import { vec2, vec4 } from "@pixelheart/client/gl-matrix";
import {
  DeferredSpriteTextures,
  SimpleSpriteEffect,
  SimpleSpriteTextures,
  SolidEffect,
} from "@pixelheart/effects";

import { GameState } from "../../client/index.js";
import { renderEditor } from "./editor.js";

export type EditorEvents = BaseEvents;

export type EditorActions =
  | BaseActions
  | {
      type: "TILE_CHANGE";
      x: number;
      y: number;
      map: string;
      value: MapTileSource;
    };

export interface PersistentEditorState {
  version: number;
  active: boolean;
}

export interface EditorState {
  active: boolean;
  newValue: string | null;
  pendingChanges: Map<string, EditorActions>;
  minimap: HTMLCanvasElement | null;
  tiles: Map<string, HTMLCanvasElement>;
  minimapSprite: SpriteSheet<SimpleSpriteTextures> | null;
  spriteEffect: SimpleSpriteEffect;
  solidEffect: SolidEffect;
}

const CURRENT_SERIALIZATION_VERSION = 2;

export default class Editor
  implements
    EditorClient<
      GameState,
      EditorState,
      PersistentEditorState,
      EditorActions,
      EditorEvents
    >
{
  #edges: Set<string>;
  #root: Root | null = null;

  constructor() {
    this.#edges = new Set<string>();
    this.#edges.add("tl");
    this.#edges.add("tr");
    this.#edges.add("bl");
    this.#edges.add("br");
    this.#edges.add("t");
    this.#edges.add("b");
    this.#edges.add("l");
    this.#edges.add("r");
    this.#edges.add("i_tl");
    this.#edges.add("i_tr");
    this.#edges.add("i_bl");
    this.#edges.add("i_br");
  }

  onStart(
    ctx: EditorContext<EditorActions, EditorEvents>,
    state: GameState,
    container: HTMLElement,
    previousState?: PersistentEditorState
  ): EditorState {
    if (
      previousState &&
      previousState.version !== CURRENT_SERIALIZATION_VERSION
    ) {
      // if its possible to gracefully handle loading a previous version, do so
      // otherwise, throw an error
      throw new Error(`Invalid save version ${previousState.version}`);
    }

    const editorState = {
      active: previousState ? previousState.active : false,
      newValue: null,
      pendingChanges: new Map(),
      minimap: null,
      tiles: new Map(),
      minimapSprite: null,
      solidEffect: new SolidEffect(ctx),
      spriteEffect: new SimpleSpriteEffect(ctx),
    };

    this.#root = createRoot(container);
    renderEditor(this.#root, ctx, state, editorState);

    return editorState;
  }

  onEnd(_container: HTMLElement): void {
    this.#root?.unmount();
    this.#root = null;
  }

  onSave(editor: EditorState): PersistentEditorState | null {
    return {
      version: CURRENT_SERIALIZATION_VERSION,
      active: editor.active,
    };
  }

  onUpdate(
    ctx: EditorContext<EditorActions, EditorEvents>,
    state: GameState,
    editor: EditorState,
    fixedDelta: number
  ) {
    if (ctx.keys.pressed.has("m") && ctx.keys.down.has("Control")) {
      editor.active = !editor.active;
    }

    if (!editor.active) {
      return;
    }

    state.resources.ifReady((r) => {
      if (ctx.mouse.down[0]) {
        const ap = coords.pickAbsoluteTileFromRelative(
          vec4.create(),
          ctx.mouse.position,
          state.screen
        );

        if (editor.newValue === null) {
          const oldValue = r.map.data.read(ap[0], ap[1]);
          const oldSprite = r.map.spriteConfig.indexes[oldValue.index];
          editor.newValue = oldSprite === "" ? "grass" : "";
        }

        this.#changeMapTile(editor, r.map, {
          sprite: editor.newValue,
          x: ap[0],
          y: ap[1],
        });
      } else {
        editor.newValue = null;
        for (let a of editor.pendingChanges.values()) {
          ctx.editorServer.send(a);
        }
        editor.pendingChanges.clear();
      }
    });
  }

  #changeMapTile(
    state: EditorState,
    map: MapContainer<DeferredSpriteTextures>,
    change: {
      sprite: string;
      x: number;
      y: number;
    }
  ) {
    this.#queueMapTileAction(state, map, change);

    const toRecheck = new Array<{
      sprite: string;
      x: number;
      y: number;
    }>();

    // reset all adjacent edge tiles to their base sprite
    for (let offsetX = -1; offsetX <= 1; ++offsetX) {
      for (let offsetY = -1; offsetY <= 1; ++offsetY) {
        const tile = map.data.read(change.x + offsetX, change.y + offsetY);
        const sprite = map.spriteConfig.indexes[tile.index];
        const splitIndex = sprite.indexOf("_");
        if (splitIndex !== -1) {
          const baseSprite = sprite.substring(0, splitIndex);
          const spriteSuffix = sprite.substring(splitIndex + 1);
          if (
            map.spriteConfig.sprites.hasOwnProperty(baseSprite) &&
            this.#edges.has(spriteSuffix)
          ) {
            const index =
              map.spriteConfig.sprites[
                baseSprite as keyof typeof map.spriteConfig.sprites
              ].index;
            tile.index = index;
            this.#queueMapTileAction(state, map, {
              sprite: baseSprite,
              x: change.x + offsetX,
              y: change.y + offsetY,
            });
            toRecheck.push({
              x: change.x + offsetX,
              y: change.y + offsetY,
              sprite: baseSprite,
            });
          }
        } else {
          toRecheck.push({
            x: change.x + offsetX,
            y: change.y + offsetY,
            sprite,
          });
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
      const top = map.data.read(check.x, check.y - 1).index === 0;
      const left = map.data.read(check.x - 1, check.y).index === 0;
      const bottom = map.data.read(check.x, check.y + 1).index === 0;
      const right = map.data.read(check.x + 1, check.y).index === 0;
      const topLeft = map.data.read(check.x - 1, check.y - 1).index === 0;
      const topRight = map.data.read(check.x + 1, check.y - 1).index === 0;
      const bottomLeft = map.data.read(check.x - 1, check.y + 1).index === 0;
      const bottomRight = map.data.read(check.x + 1, check.y + 1).index === 0;

      if (top && left) {
        newEdges.push({
          x: check.x,
          y: check.y,
          sprite: check.sprite + "_tl",
        });
      } else if (top && right) {
        newEdges.push({
          x: check.x,
          y: check.y,
          sprite: check.sprite + "_tr",
        });
      } else if (top && !left && !right) {
        newEdges.push({
          x: check.x,
          y: check.y,
          sprite: check.sprite + "_t",
        });
      } else if (topLeft && !left && !top) {
        newEdges.push({
          x: check.x,
          y: check.y,
          sprite: check.sprite + "_i_tl",
        });
      } else if (topRight && !right && !top) {
        newEdges.push({
          x: check.x,
          y: check.y,
          sprite: check.sprite + "_i_tr",
        });
      } else if (left && !top && !bottom) {
        newEdges.push({
          x: check.x,
          y: check.y,
          sprite: check.sprite + "_l",
        });
      } else if (bottom && left) {
        newEdges.push({
          x: check.x,
          y: check.y,
          sprite: check.sprite + "_bl",
        });
      } else if (bottom && right) {
        newEdges.push({
          x: check.x,
          y: check.y,
          sprite: check.sprite + "_br",
        });
      } else if (bottom && !left && !right) {
        newEdges.push({
          x: check.x,
          y: check.y,
          sprite: check.sprite + "_b",
        });
      } else if (bottomLeft && !left && !bottom) {
        newEdges.push({
          x: check.x,
          y: check.y,
          sprite: check.sprite + "_i_bl",
        });
      } else if (bottomRight && !right && !bottom) {
        newEdges.push({
          x: check.x,
          y: check.y,
          sprite: check.sprite + "_i_br",
        });
      } else if (right && !top && !bottom) {
        newEdges.push({
          x: check.x,
          y: check.y,
          sprite: check.sprite + "_r",
        });
      }
    }

    for (let edge of newEdges) {
      if (map.spriteConfig.sprites.hasOwnProperty(edge.sprite)) {
        this.#queueMapTileAction(state, map, edge);
      }
    }
  }

  #queueMapTileAction(
    state: EditorState,
    map: MapContainer<DeferredSpriteTextures>,
    {
      sprite,
      x,
      y,
    }: {
      sprite: string;
      x: number;
      y: number;
    }
  ) {
    let action = state.pendingChanges.get(`${x},${y}`);
    if (!action) {
      action = {
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
      state.pendingChanges.set(`${x},${y}`, action);
    }

    if (action.type === "TILE_CHANGE") {
      Object.assign(action.value, {
        sprite,
        animated: false,
        walkable: sprite !== "",
        triggerId: 0,
        spatialHash: sprite !== "",
      });
      const index =
        sprite === ""
          ? 0
          : map.spriteConfig.sprites[
              sprite as keyof typeof map.spriteConfig.sprites
            ].index;
      map.data.write(x, y, { ...action.value, index });
    }
  }

  onDraw(
    ctx: EditorContext<EditorActions, EditorEvents>,
    state: GameState,
    editor: EditorState,
    delta: number
  ) {
    if (!editor.active) {
      return;
    }
    state.resources.ifReady((r) => {
      const ap = coords.pickAbsoluteTileFromRelative(
        vec4.create(),
        ctx.mouse.position,
        state.screen
      );

      state.solidEffect.use((s) => {
        // editor cursor
        s.setBorder(ctx.screen, 1);
        s.draw(
          coords.toScreenSpaceFromAbsoluteTile(vec4.create(), ap, {
            ...state.screen,
            ...ctx.screen,
          }),
          vec4.fromValues(1.0, 0, 0, 0.5),
          vec4.fromValues(1.0, 1.0, 1.0, 1.0)
        );

        // character bounding box
        const offset = vec2.fromValues(
          r.character.animator.getSprite().width / 2,
          r.character.animator.getSprite().height / 2
        );
        s.draw(
          ctx.screen.toScreenSpace(
            vec4.create(),
            vec4.fromValues(
              Math.floor(r.character.relativePosition[1]) -
                offset[1] +
                r.character.boundingBox[0],
              Math.floor(r.character.relativePosition[0]) -
                offset[0] +
                r.character.boundingBox[1],
              Math.floor(r.character.relativePosition[1]) -
                offset[1] +
                r.character.boundingBox[2],
              Math.floor(r.character.relativePosition[0]) -
                offset[0] +
                r.character.boundingBox[3]
            )
          ),
          vec4.fromValues(0.0, 0, 1.0, 0.5)
        );
      });
    });
  }

  onDrawExtra(
    ctx: EditorContext<EditorActions, EditorEvents>,
    state: GameState,
    editor: EditorState,
    delta: number,
    renderScope: (
      renderTarget: ImageBitmapRenderingContext,
      cb: () => void
    ) => void
  ) {
    if (!editor.active) {
      return;
    }

    state.resources.ifReady((r) => {
      if (!editor.minimap) {
        return;
      }

      const minimap = editor.minimap;
      const target = minimap.getContext("bitmaprenderer");
      const parent = minimap.parentElement;
      if (!parent || !target) {
        return;
      }

      const xScale = parent.clientWidth / r.map.data.width;
      const yScale = parent.clientHeight / r.map.data.height;
      const scale = Math.max(1.0, Math.floor(Math.min(xScale, yScale)));

      minimap.width = r.map.data.width * scale;
      minimap.height = r.map.data.height * scale;

      renderScope(target, () => {
        const minimapSprite = (editor.minimapSprite =
          editor.minimapSprite ||
          loadSpriteSheetSync(
            ctx,
            r.map.spriteConfig,
            r.map.sprite[TEXTURE].diffuseTexture
          ));

        // draw the ocean
        editor.solidEffect.use((s) => {
          s.draw(
            vec4.fromValues(0, 0, 1.0, 1.0),
            vec4.fromValues(50.0 / 255.0, 124.0 / 255.0, 224.0 / 255.0, 1.0)
          );
        });
        // draw the tiles
        editor.spriteEffect.use((s) => {
          const xScale = 1.0 / r.map.data.width;
          const yScale = 1.0 / r.map.data.height;
          for (let x = 0; x < r.map.data.width; ++x) {
            for (let y = 0; y < r.map.data.height; ++y) {
              const tile = r.map.data.read(x, y);
              if (tile.index > 0) {
                const sprite = r.map.spriteConfig.indexes[tile.index];
                const position = vec4.fromValues(
                  y * yScale,
                  (x + 1) * xScale,
                  (y + 1) * yScale,
                  x * xScale
                );
                minimapSprite[sprite].draw(s, position);
              }
            }
          }
        });
        // draw the screen position
        editor.solidEffect.use((s) => {
          const position = vec4.fromValues(
            state.screen.absolutePosition[1],
            state.screen.absolutePosition[0] + ctx.screen.width,
            state.screen.absolutePosition[1] + ctx.screen.height,
            state.screen.absolutePosition[0]
          );
          vec4.scale(position, position, 1.0 / coords.TILE_SIZE);
          vec4.multiply(
            position,
            position,
            vec4.fromValues(
              1.0 / r.map.data.height,
              1.0 / r.map.data.width,
              1.0 / r.map.data.height,
              1.0 / r.map.data.width
            )
          );
          s.setBorder(minimap, 2);
          s.draw(
            position,
            vec4.fromValues(1.0, 1.0, 1.0, 0.2),
            vec4.fromValues(1.0, 1.0, 1.0, 1.0)
          );
        });
      });

      // render editor tiles
      for (let [tileId, tileCanvas] of editor.tiles) {
        tileCanvas.width = coords.TILE_SIZE * 4;
        tileCanvas.height = coords.TILE_SIZE * 4;

        const target = tileCanvas.getContext("bitmaprenderer");
        if (!target) {
          continue;
        }

        renderScope(target, () => {
          ctx.gl.texParameteri(
            ctx.gl.TEXTURE_2D,
            ctx.gl.TEXTURE_MIN_FILTER,
            ctx.gl.NEAREST
          );
          ctx.gl.texParameteri(
            ctx.gl.TEXTURE_2D,
            ctx.gl.TEXTURE_MAG_FILTER,
            ctx.gl.NEAREST
          );

          // editor tiles apply the same lighting as the
          // game engine
          for (const l of state.directionalLighting) {
            state.spriteEffect.addDirectionalLight(l);
          }
          state.spriteEffect.use(
            {
              width: tileCanvas.width,
              height: tileCanvas.height,
            },
            (s, _pass) => {
              r.map.sprite[tileId].draw(s, vec4.fromValues(0.0, 1.0, 1.0, 0.0));
            },
            (_mask) => {}
          );

          // draw the accumulated deferred lighting texture to the screen
          state.simpleSpriteEffect.use((s) => {
            const lightingTexture = state.spriteEffect.getLightingTexture();
            if (lightingTexture) {
              s.setTextures(lightingTexture);
              s.draw(
                vec4.fromValues(1.0, 1.0, 0, 0),
                vec4.fromValues(
                  0,
                  lightingTexture.width,
                  lightingTexture.height,
                  0
                )
              );
            }
          });
        });
      }
    });
  }
}
