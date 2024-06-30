import React, { useEffect, useReducer, useCallback, useRef, useState } from "react";
import { Root } from "react-dom/client";

import { EditorContext, coords } from "@pixelheart/client";

import { GameState } from "../../client/index.js";
import {
  EditorActions,
  EditorEvents,
  EditorState,
  EditorSelectableTool,
  EditorInvokableTool,
  IsEdgeTile
} from "./index.js";
import { VirtualizedCanvasList } from "./virtual-canvas-list.js";
import { UndoIcon, RedoIcon, DrawIcon, EraseIcon } from "./tool-icons.js";


interface EditorClientState {
  game: GameState;
  editor: EditorState;
  ctx: EditorContext<EditorActions, EditorEvents>;
  tiles: Array<string>;
}

// receive editor events as well as client initiated actions
type EditorUIActions =
  | EditorEvents
  | {
    type: "TOGGLE_EDITOR";
  }
  | {
    type: "SELECT_TOOL";
    tool: EditorSelectableTool;
  }
  | {
    type: "INVOKE_TOOL";
    tool: EditorInvokableTool;
  }
  | {
    type: "SELECT_TILE";
    tile: string | null;
  }
  | {
    type: "LOAD_TILES";
    tiles: Array<string>;
  };

export function renderEditor(
  root: Root,
  ctx: EditorContext<EditorActions, EditorEvents>,
  state: GameState,
  editorState: EditorState
) {
  root.render(<EditorComponent tiles={[]} ctx={ctx} game={state} editor={editorState} />);
}

function reducer(
  state: EditorClientState,
  action: EditorUIActions
): EditorClientState {
  // NOTE: we mutate the game & editor fields rather than creating new references
  // as those objects are shared with the game client
  switch (action.type) {
    case "TOGGLE_EDITOR":
      return {
        ...state,
        editor: Object.assign(state.editor, {
          active: !state.editor.active,
        }),
      };
    case "SELECT_TOOL":
      return {
        ...state,
        editor: Object.assign(state.editor, {
          selectedTool: action.tool,
        }),
      };
    case "INVOKE_TOOL":
      return {
        ...state,
        editor: Object.assign(state.editor, {
          pendingToolInvocations: [...state.editor.pendingToolInvocations, action.tool],
        })
      };
    case "SELECT_TILE":
      return {
        ...state,
        editor: Object.assign(state.editor, {
          selectedTile: action.tile,
        })
      };
    case "LOAD_TILES":
      const tiles = action.tiles;
      const selectedTile = (!state.editor.selectedTile || tiles.indexOf(state.editor.selectedTile) < 0) ? tiles[0] : state.editor.selectedTile;
      return {
        ...state,
        tiles,
        editor: Object.assign(state.editor, {
          selectedTile,
        }),
      };
    case "EDIT_MAP_TILES_APPLY":
      // applying tile changes means this editor may have initiated the changes
      // which means we may have some undo/redo stack changes to reflect in the UI
      // so we need to mutate state for that to cause a re-render
      return {
        ...state,
      };

  }
  return state;
}

function EditorButton(props: {
  className?: string;
  onClick: () => void;
  shortcutKey?: (e: KeyboardEvent) => boolean,
  text?: string;
  label?: string;
  selected?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (props.shortcutKey?.(e)) {
      e.preventDefault();
      props.onClick();
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [props.shortcutKey, props.onClick]);

  return (
    <button
      className={
        (props.className ?? "") +
        (props.selected ? " border-white bg-gray-600" : " border-gray-600") +
        (props.disabled ? " text-gray-600 bg-gray-800" : " text-white bg-gray-700") +
        (!props.selected && !props.disabled ? " hover-gray-600 hover:border-gray-500" : "") +
        " mr-2 border-2 rounded-sm text-xs font-bold h-6 pl-1 pr-1 transition ease-in-out"
      }
      onClick={props.onClick}
      aria-label={props.label || props.text}
      title={props.label}
    >
      {props.text || props.children}
    </button>
  );
}

function useExternalCanvas(canvas: HTMLCanvasElement, active: boolean) {
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      canvasContainerRef.current &&
      canvas.parentElement !== canvasContainerRef.current
    ) {
      if (canvas.parentElement) {
        canvas.parentElement.removeChild(canvas);
      }
      canvasContainerRef.current.appendChild(canvas);
    }
    return () => {
      if (
        canvasContainerRef.current &&
        canvas.parentElement === canvasContainerRef.current
      ) {
        canvasContainerRef.current.removeChild(canvas);
      }
    };
  }, [canvas, active]);

  return canvasContainerRef;
}

function EditorComponent(props: EditorClientState) {
  const [state, dispatch] = useReducer(reducer, props);

  useEffect(() => {
    // make sure editor server events are dispatched to the reducer
    state.ctx.editorServer.listen(dispatch);
    return () => {
      state.ctx.editorServer.disconnect(dispatch);
    };
  }, [dispatch, state.ctx.editorServer]);

  useEffect(() => {
    // TODO need to notify when map is reloaded to reset this
    state.game.resources.whenReady().then((resources) => {
      dispatch({
        type: "LOAD_TILES",
        tiles: Object.keys(resources.map.spriteConfig.sprites).filter(s => !IsEdgeTile(s)),
      });
    });
  }, [state.game.resources]);

  const minimapRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    state.editor.minimap = minimapRef.current;
  });

  const gameCanvasContainerRef = useExternalCanvas(
    state.ctx.canvas,
    state.editor.active
  );

  return state.editor.active ? (
    <div className="flex flex-col w-full">
      <div className="flex pl-2 pt-2 pb-2 bg-gray-900 flex-row border-b-2 border-gray-600">
        <div className="grow">
          <EditorButton onClick={() => {
            dispatch({ type: "SELECT_TOOL", tool: "DRAW" });
          }}
            selected={state.editor.selectedTool === "DRAW"}
            label="Draw">
            <DrawIcon />
          </EditorButton>
          <EditorButton
            selected={state.editor.selectedTool === "ERASE"}
            onClick={() => {
              dispatch({ type: "SELECT_TOOL", tool: "ERASE" });
            }}
            label="Erase">
            <EraseIcon />
          </EditorButton>
          <EditorButton
            onClick={() => {
              dispatch({ type: "INVOKE_TOOL", tool: "UNDO" });
            }}
            disabled={state.editor.undoStackHead < 0}
            shortcutKey={(e: KeyboardEvent) => e.ctrlKey && e.key === "z"}
            label="Undo">
            <UndoIcon />
          </EditorButton>
          <EditorButton
            onClick={() => {
              dispatch({ type: "INVOKE_TOOL", tool: "REDO" });
            }}
            disabled={
              state.editor.undoStack.length <= state.editor.undoStackHead + 1
            }
            shortcutKey={(e: KeyboardEvent) => e.ctrlKey && e.key === "y"}
            label="Redo">
            <RedoIcon />
          </EditorButton>
        </div>
        <EditorButton
          onClick={() => {
            dispatch({ type: "TOGGLE_EDITOR" });
          }}
          text="Close Editor"
        />
      </div>
      <div
        className="flex grow overflow-hidden relative"
        ref={gameCanvasContainerRef}
      >
        <div className="absolute top-2 right-2 z-10">
          <div
            className="border-2 border-gray-600 bg-gray-900 overflow-hidden aspect-square opacity-90"
            style={{ maxWidth: "20vw" }}
          >
            <canvas ref={minimapRef} />
          </div>
        </div>
        {state.editor.selectedTool === "DRAW" ?
          <VirtualizedCanvasList
            className="content-start absolute grid grid-cols-3 gap-0 top-2 left-2 z-10 border-2 border-gray-600 bg-gray-900 bottom-2 opacity-90 overflow-y-auto"
            canvases={state.editor.tiles}
            items={state.tiles}
            itemTemplate={TileComponent}
            onItemClick={(id: string) => dispatch({
              type: "SELECT_TILE",
              tile: id,
            })}
            selectedItem={state.editor.selectedTile}
          /> : null}
      </div>
    </div>
  ) : (
    <>
      <EditorButton
        className="absolute top-2 right-0 z-10"
        onClick={() => {
          dispatch({ type: "TOGGLE_EDITOR" });
        }}
        text="Open Editor"
      />
      <div
        className="flex grow overflow-hidden w-full"
        ref={gameCanvasContainerRef}
      ></div>
    </>
  );
}

const TileComponent = React.forwardRef(
  (
    {
      isSelected,
      onClick,
    }: {
      id: string;
      isVisible: boolean;
      isSelected: boolean;
      onClick: () => void;
    },
    canvasRef: React.ForwardedRef<HTMLCanvasElement>
  ) => {
    const className =
      "border-2 grow-0 border-gray-900 hover:bg-gray-600 hover:border-white" +
      (isSelected ? " bg-gray-600" : "");
    return (
      <li
        style={{
          padding: coords.TILE_SIZE / 2 - 2,
        }}
        className={className}
        onClick={onClick}
      >
        <canvas
          style={{
            width: coords.TILE_SIZE * 2,
            height: coords.TILE_SIZE * 2,
          }}
          ref={canvasRef}
        />
      </li>
    );
  }
);
