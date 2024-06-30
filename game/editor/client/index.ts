import { Root, createRoot } from "react-dom/client";

import {
  BaseActions,
  BaseEvents,
  EditorClient,
  EditorContext,
  MapContainer,
  MapTileSource,
  MapTile,
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
import UndoStack from "./undo-stack.js";
import { TILE_SIZE } from "node_modules/@pixelheart/client/dist/coordinates.js";

export type MapTileChange = {
  x: number,
  y: number,
  value: Partial<MapTileSource>
};

export type EditMapTilesAction = {
  type: "EDIT_MAP_TILES";
  tiles: Array<MapTileChange>;
  map: string;
};

export type MapTileChangeApply = {
  x: number,
  y: number,
  value: MapTile
};

export type EditMapTilesEvent = {
  type: "EDIT_MAP_TILES_APPLY";
  tiles: Array<MapTileChangeApply>;
  map: string;
};

export type EditorEvents = BaseEvents | EditMapTilesEvent;

export type EditorActions =
  | BaseActions
  | EditMapTilesAction;

export interface PersistentEditorState {
  version: number;
  active: boolean;
  selectedTool: EditorSelectableTool;
  selectedTile: string | null;
}

export type EditorSelectableTool = "DRAW" | "ERASE";
export type EditorInvokableTool = "UNDO" | "REDO";

export interface EditorState {
  active: boolean;
  selectedTool: EditorSelectableTool;
  selectedTile: string | null;
  pendingToolInvocations: Array<EditorInvokableTool>;
  undoStack: UndoStack<Array<MapTileChange>>;
  currentSelection: vec4 | null;
  minimap: HTMLCanvasElement | null;
  tiles: Map<string, HTMLCanvasElement>;
  minimapSprite: SpriteSheet<SimpleSpriteTextures> | null;
  spriteEffect: SimpleSpriteEffect;
  solidEffect: SolidEffect;
}

const CURRENT_SERIALIZATION_VERSION = 2;

export const TileEdgeSuffixes = new Set();
for (let e of [
  "tl",
  "tr",
  "bl",
  "br",
  "t",
  "b",
  "l",
  "r",
  "i_tl",
  "i_tr",
  "i_bl",
  "i_br",
]) {
  TileEdgeSuffixes.add(e);
}

export function IsEdgeTile(sprite: string): boolean {
  const splitIndex = sprite.indexOf("_");
  if (splitIndex !== -1) {
    const spriteSuffix = sprite.substring(splitIndex + 1);
    return TileEdgeSuffixes.has(spriteSuffix)
  }
  return false;
}

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
  #root: Root | null = null;
  #pendingEvents: Array<EditorEvents>;

  constructor() {
    this.#pendingEvents = [];
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
      selectedTile: previousState ? previousState.selectedTile : null,
      selectedTool: previousState ? previousState.selectedTool : "DRAW" as EditorSelectableTool,
      pendingToolInvocations: [],
      undoStack: new UndoStack<Array<MapTileChange>>(),
      currentSelection: null,
      minimap: null,
      tiles: new Map(),
      minimapSprite: null,
      solidEffect: new SolidEffect(ctx),
      spriteEffect: new SimpleSpriteEffect(ctx),
    };

    this.#root = createRoot(container);
    renderEditor(this.#root, ctx, state, editorState);

    ctx.editorServer.listen(this.#onEvent);

    return editorState;
  }

  onEnd(ctx: EditorContext<EditorActions, EditorEvents>, _container: HTMLElement): void {
    ctx.editorServer.disconnect(this.#onEvent);
    this.#root?.unmount();
    this.#root = null;
  }

  #onEvent = (evt: EditorEvents) => {
    // queue socket events so we can process them on the main event loop
    this.#pendingEvents.push(evt);
  }

  onSave(editor: EditorState): PersistentEditorState | null {
    return {
      version: CURRENT_SERIALIZATION_VERSION,
      active: editor.active,
      selectedTool: editor.selectedTool,
      selectedTile: editor.selectedTile,
    };
  }

  onUpdate(
    ctx: EditorContext<EditorActions, EditorEvents>,
    state: GameState,
    editor: EditorState,
    _fixedDelta: number
  ) {
    if (ctx.keys.pressed.has("m") && ctx.keys.down.has("Control")) {
      editor.active = !editor.active;
    }

    if (!editor.active) {
      return;
    }

    state.resources.ifReady((r) => {

      // process all editor server events
      if (this.#pendingEvents.length) {
        for (let evt of this.#pendingEvents) {
          switch (evt.type) {
            case "EDIT_MAP_TILES_APPLY": {
              if (evt.map === r.map.name) {
                for (let change of evt.tiles) {
                  r.map.data.write(change.x, change.y, change.value);
                }
              }
              break;
            }
          }
        }
        this.#pendingEvents.length = 0;
      }

      // process all tool invocations
      if (editor.pendingToolInvocations.length) {
        for (let action of editor.pendingToolInvocations) {
          switch (action) {
            case "UNDO": {
              const tiles = editor.undoStack.undo();
              if (tiles) {
                const action: EditMapTilesAction = {
                  type: "EDIT_MAP_TILES",
                  tiles,
                  map: r.map.name,
                };
                ctx.editorServer.send(action);
              }
              break;
            }
            case "REDO": {
              const tiles = editor.undoStack.redo();
              if (tiles) {
                const action: EditMapTilesAction = {
                  type: "EDIT_MAP_TILES",
                  tiles,
                  map: r.map.name,
                };
                ctx.editorServer.send(action);
              }
            }
          }
        }
        editor.pendingToolInvocations.length = 0;
      }

      const ap = coords.pickAbsoluteTileFromRelative(
        vec4.create(),
        ctx.mouse.position,
        state.screen
      );

      if (ctx.mouse.down[0]) {
        if (!editor.currentSelection) {
          editor.currentSelection = ap;
        }
      } else if (editor.currentSelection) {
        const lx = Math.min(ap[0], editor.currentSelection[0]);
        const hx = Math.max(ap[0], editor.currentSelection[0]);
        const ly = Math.min(ap[1], editor.currentSelection[1]);
        const hy = Math.max(ap[1], editor.currentSelection[1]);

        switch (editor.selectedTool) {
          case "ERASE":
            const dedupedActions = new Map<string, MapTileChange>();
            for (let x = lx; x <= hx; ++x) {
              for (let y = ly; y <= hy; ++y) {
                this.#changeMapTile(dedupedActions, r.map, {
                  x, y,
                  value: { sprite: "" },
                });
              }
            }
            const action: EditMapTilesAction = {
              type: "EDIT_MAP_TILES",
              tiles: Array.from(dedupedActions.values()),
              map: r.map.name,
            };
            if (this.#recordMapTileUndo(editor, action.tiles, r.map)) {
              ctx.editorServer.send(action);
            }
            break;

          case "DRAW":
            const sprite = editor.selectedTile;
            if (sprite) {
              const dedupedActions = new Map<string, MapTileChange>();
              for (let x = lx; x <= hx; ++x) {
                for (let y = ly; y <= hy; ++y) {
                  this.#changeMapTile(dedupedActions, r.map, { x, y, value: { sprite } });
                }
              }
              const action: EditMapTilesAction = {
                type: "EDIT_MAP_TILES",
                tiles: Array.from(dedupedActions.values()),
                map: r.map.name,
              };
              if (this.#recordMapTileUndo(editor, action.tiles, r.map)) {
                ctx.editorServer.send(action);
              }
            }
            break;
        }

        editor.currentSelection = null;
      }
    });
  }

  #recordMapTileUndo(
    editor: EditorState,
    changes: Array<MapTileChange>,
    map: MapContainer<DeferredSpriteTextures>
  ) {
    const undoChanges: Array<MapTileChange> = [];

    for (const c of changes) {
      const tile = map.data.read(c.x, c.y);
      const sprite = tile.index ? map.spriteConfig.indexes[tile.index] : "";
      const { index: _, ...source } = tile;

      const value = { ...source, sprite };

      if (
        JSON.stringify({ ...source, ...c.value }) ===
        JSON.stringify(value)) {
        continue;
      }

      undoChanges.push({
        x: c.x,
        y: c.y,
        value,
      });
    }

    if (undoChanges.length === 0) {
      // if the total set of changes introduces no actual changes to the tiles
      // then we'll ignore it
      return false;
    }

    editor.undoStack.push(undoChanges, changes);
    return true;
  }

  #changeMapTile(
    context: Map<string, MapTileChange>,
    map: MapContainer<DeferredSpriteTextures>,
    change: MapTileChange,
  ) {
    const applyChange = (
      c: MapTileChange
    ) => {
      const { x, y } = c;
      let existingChange = context.get(`${x},${y}`);
      if (!existingChange) {
        existingChange = { x, y, value: { ...c.value } };
        context.set(`${x},${y}`, existingChange);
      }

      Object.assign(existingChange.value, c.value);
    };

    const getTileSprite = (x: number, y: number) => {
      let existingChange = context.get(`${x},${y}`);
      if (!existingChange) {
        const tileIndex = map.data.read(x, y).index;
        return map.spriteConfig.indexes[tileIndex];
      } else {
        return existingChange.value.sprite || "";
      }
    };

    applyChange(change);

    const toRecheck = new Array<{
      value: { sprite: string };
      x: number;
      y: number;
    }>();

    // reset all adjacent edge tiles to their base sprite
    for (let offsetX = -1; offsetX <= 1; ++offsetX) {
      for (let offsetY = -1; offsetY <= 1; ++offsetY) {
        const sprite = getTileSprite(change.x + offsetX, change.y + offsetY);
        const splitIndex = sprite.indexOf("_");
        if (splitIndex !== -1) {
          const baseSprite = sprite.substring(0, splitIndex);
          const spriteSuffix = sprite.substring(splitIndex + 1);
          if (
            map.spriteConfig.sprites.hasOwnProperty(baseSprite) &&
            TileEdgeSuffixes.has(spriteSuffix)
          ) {
            const c = {
              x: change.x + offsetX,
              y: change.y + offsetY,
              value: { sprite: baseSprite },
            };
            applyChange(c);
            toRecheck.push(c);
          }
        } else {
          toRecheck.push({
            x: change.x + offsetX,
            y: change.y + offsetY,
            value: { sprite },
          });
        }
      }
    }

    const newEdges = Array<{
      x: number;
      y: number;
      value: { sprite: string };
    }>();

    // convert any tiles that should be to edges (if a suitable sprite exists)
    for (let check of toRecheck) {
      const top = getTileSprite(check.x, check.y - 1) === "";
      const left = getTileSprite(check.x - 1, check.y) === "";
      const bottom = getTileSprite(check.x, check.y + 1) === "";
      const right = getTileSprite(check.x + 1, check.y) === "";
      const topLeft = getTileSprite(check.x - 1, check.y - 1) === "";
      const topRight = getTileSprite(check.x + 1, check.y - 1) === "";
      const bottomLeft = getTileSprite(check.x - 1, check.y + 1) === "";
      const bottomRight = getTileSprite(check.x + 1, check.y + 1) === "";

      if (top && left) {
        newEdges.push({
          x: check.x,
          y: check.y,
          value: { sprite: check.value.sprite + "_tl" },
        });
      } else if (top && right) {
        newEdges.push({
          x: check.x,
          y: check.y,
          value: { sprite: check.value.sprite + "_tr" },
        });
      } else if (top && !left && !right) {
        newEdges.push({
          x: check.x,
          y: check.y,
          value: { sprite: check.value.sprite + "_t" },
        });
      } else if (topLeft && !left && !top) {
        newEdges.push({
          x: check.x,
          y: check.y,
          value: { sprite: check.value.sprite + "_i_tl" },
        });
      } else if (topRight && !right && !top) {
        newEdges.push({
          x: check.x,
          y: check.y,
          value: { sprite: check.value.sprite + "_i_tr" },
        });
      } else if (left && !top && !bottom) {
        newEdges.push({
          x: check.x,
          y: check.y,
          value: { sprite: check.value.sprite + "_l" },
        });
      } else if (bottom && left) {
        newEdges.push({
          x: check.x,
          y: check.y,
          value: { sprite: check.value.sprite + "_bl" },
        });
      } else if (bottom && right) {
        newEdges.push({
          x: check.x,
          y: check.y,
          value: { sprite: check.value.sprite + "_br" },
        });
      } else if (bottom && !left && !right) {
        newEdges.push({
          x: check.x,
          y: check.y,
          value: { sprite: check.value.sprite + "_b" },
        });
      } else if (bottomLeft && !left && !bottom) {
        newEdges.push({
          x: check.x,
          y: check.y,
          value: { sprite: check.value.sprite + "_i_bl" },
        });
      } else if (bottomRight && !right && !bottom) {
        newEdges.push({
          x: check.x,
          y: check.y,
          value: { sprite: check.value.sprite + "_i_br" },
        });
      } else if (right && !top && !bottom) {
        newEdges.push({
          x: check.x,
          y: check.y,
          value: { sprite: check.value.sprite + "_r" },
        });
      }
    }

    for (let edge of newEdges) {
      if (map.spriteConfig.sprites.hasOwnProperty(edge.value.sprite)) {
        applyChange(edge);
      }
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

      const startAp = editor.currentSelection ?? ap;

      const cursorPos = coords.toScreenSpaceFromAbsoluteTile(vec4.create(), ap, {
        ...state.screen,
        ...ctx.screen,
      });

      const cursorStartPos = coords.toScreenSpaceFromAbsoluteTile(vec4.create(), startAp, {
        ...state.screen,
        ...ctx.screen,
      });

      switch (editor.selectedTool) {
        case "DRAW": {
          const selectedTile = editor.selectedTile;
          if (selectedTile) {
            // editor tiles apply the same lighting as the game engine
            for (const l of state.directionalLighting) {
              state.spriteEffect.addDirectionalLight(l);
            }
            state.spriteEffect.use({
              width: TILE_SIZE,
              height: TILE_SIZE,
            }, (s) => {
              r.map.sprite[selectedTile].draw(s, vec4.fromValues(0.0, 1.0, 1.0, 0.0));
            });
            // draw the accumulated deferred lighting texture to the screen
            state.simpleSpriteEffect.use((s) => {
              const lightingTexture = state.spriteEffect.getLightingTexture();
              if (lightingTexture) {
                s.setTextures(lightingTexture);
                s.setAlpha(0.8);

                const xd = cursorPos[1] - cursorPos[3];
                const yd = cursorPos[2] - cursorPos[0];
                const lx = Math.min(cursorPos[3], cursorStartPos[3]);
                const ly = Math.min(cursorPos[0], cursorStartPos[0]);
                const width = Math.abs(ap[0] - startAp[0]);
                const height = Math.abs(ap[1] - startAp[1]);

                for (let x = 0; x <= width; ++x) {
                  for (let y = 0; y <= height; ++y) {
                    s.draw(
                      vec4.fromValues(
                        (y * yd) + ly,
                        (x * xd) + lx + xd,
                        (y * yd) + ly + yd,
                        (x * xd) + lx
                      ),
                      vec4.fromValues(
                        0,
                        lightingTexture.width,
                        lightingTexture.height,
                        0
                      )
                    );
                  }
                }
              }
            });
          }
          state.solidEffect.use((s) => {
            s.setBorder(ctx.screen, 1);
            s.draw(
              vec4.fromValues(
                Math.min(cursorPos[0], cursorStartPos[0]),
                Math.max(cursorPos[1], cursorStartPos[1]),
                Math.max(cursorPos[2], cursorStartPos[2]),
                Math.min(cursorPos[3], cursorStartPos[3])
              ),
              vec4.fromValues(1.0, 0, 0, 0.0),
              vec4.fromValues(1.0, 1.0, 1.0, 1.0)
            );
          });
        }
          break;

        case "ERASE":
          state.solidEffect.use((s) => {
            s.setBorder(ctx.screen, 1);
            s.draw(
              vec4.fromValues(
                Math.min(cursorPos[0], cursorStartPos[0]),
                Math.max(cursorPos[1], cursorStartPos[1]),
                Math.max(cursorPos[2], cursorStartPos[2]),
                Math.min(cursorPos[3], cursorStartPos[3])
              ),
              vec4.fromValues(1.0, 0, 0, 0.5),
              vec4.fromValues(1.0, 1.0, 1.0, 1.0)
            );
          });
          break;
      }

      state.solidEffect.use((s) => {
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
            (s) => {
              r.map.sprite[tileId].draw(s, vec4.fromValues(0.0, 1.0, 1.0, 0.0));
            }
          );

          // draw the accumulated deferred lighting texture to the screen
          state.simpleSpriteEffect.use((s) => {
            const lightingTexture = state.spriteEffect.getLightingTexture();
            if (lightingTexture) {
              s.setTextures(lightingTexture);
              s.draw(
                vec4.fromValues(0.0, 1.0, 1.0, 0.0),
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
