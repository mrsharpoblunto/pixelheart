import { vec2, vec4 } from "gl-matrix";
import React, { useEffect, useRef } from "react";
import { Root, createRoot } from "react-dom/client";

import { EditorClient, EditorContext } from "@pixelheart/api";
import * as coords from "@pixelheart/coordinates";
import { DeferredSpriteTextures } from "@pixelheart/effects/deferred-sprite-effect";
import { reloadShader } from "@pixelheart/gl-utils";
import { reloadImage } from "@pixelheart/images";
import { MapContainer } from "@pixelheart/map";
import { reloadSprite } from "@pixelheart/sprite";

import {
  EditorActions,
  EditorEvents,
  EditorState,
  GameState,
  PersistentEditorState,
} from "../../";

const CURRENT_SERIALIZATION_VERSION = 1;

interface EditorProps {
  state: GameState;
  editorState: EditorState;
  canvas: HTMLCanvasElement;
}

function EditorComponent({ state, editorState, canvas }: EditorProps) {
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.appendChild(canvas);
    }
    return () => {
      if (canvasRef.current) {
        canvasRef.current.removeChild(canvas);
      }
    };
  }, [state, editorState]);

  return <div ref={canvasRef}></div>;
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
    ctx: EditorContext<EditorActions>,
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
    };
    this.#root = createRoot(container);
    this.#root.render(
      <EditorComponent
        state={state}
        canvas={ctx.canvas}
        editorState={editorState}
      />
    );
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

  onEvent(
    ctx: EditorContext<EditorActions>,
    state: GameState,
    editor: EditorState,
    event: EditorEvents
  ) {
    switch (event.type) {
      case "RELOAD_SHADER": {
        reloadShader(event.shader, event.src);
        break;
      }
      case "RELOAD_SPRITESHEET": {
        reloadImage(event.spriteSheet);
        reloadSprite(event.spriteSheet);
        break;
      }
    }
  }

  onUpdate(
    ctx: EditorContext<EditorActions>,
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
          ctx.editor.send(a);
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
    ctx: EditorContext<EditorActions>,
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
        s.draw(
          coords.toScreenSpaceFromAbsoluteTile(vec4.create(), ap, {
            ...state.screen,
            ...ctx.screen,
          }),
          vec4.fromValues(1.0, 0, 0, 0.5)
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
}
