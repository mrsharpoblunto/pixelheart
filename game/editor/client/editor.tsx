import React, { useEffect, useReducer, useRef, useState } from "react";
import { Root } from "react-dom/client";

import { EditorContext, coords } from "@pixelheart/client";

import { GameState } from "../../client/index.js";
import { EditorActions, EditorEvents, EditorState } from "./index.js";
import { VirtualizedCanvasList } from "./virtual-canvas-list.js";

interface EditorClientState {
  game: GameState;
  editor: EditorState;
  ctx: EditorContext<EditorActions, EditorEvents>;
}

// receive editor events as well as client initiated actions
type EditorUIActions =
  | EditorEvents
  | {
      type: "TOGGLE_EDITOR";
    };

export function renderEditor(
  root: Root,
  ctx: EditorContext<EditorActions, EditorEvents>,
  state: GameState,
  editorState: EditorState
) {
  root.render(<EditorComponent ctx={ctx} game={state} editor={editorState} />);
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
  }
  return state;
}

function EditorButton(props: {
  className?: string;
  onClick: () => void;
  text: string;
}) {
  return (
    <button
      className={
        (props.className ?? "") +
        " border-2 border-gray-600 rounded-sm bg-gray-700 text-xs text-white font-bold h-6 pl-1 pr-1 hover:bg-gray-600 hover:border-gray-500 transition ease-in-out"
      }
      onClick={props.onClick}
    >
      {props.text}
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
  const [tiles, setTiles] = useState<Array<string>>([]);

  useEffect(() => {
    // make sure editor server events are dispatched to the reducer
    props.ctx.editorServer.onEvent(dispatch);
  }, [dispatch, props.ctx.editorServer]);

  const minimapRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    props.editor.minimap = minimapRef.current;
  });

  const gameCanvasContainerRef = useExternalCanvas(
    props.ctx.canvas,
    props.editor.active
  );

  useEffect(() => {
    // TODO need to notify when map is reloaded to reset this
    props.game.resources.whenReady().then((resources) => {
      // TODO filter out _direction alts for tiles...
      setTiles(Object.keys(resources.map.spriteConfig.sprites));
    });
  }, [props.game.resources]);

  return state.editor.active ? (
    <div className="flex flex-col w-full">
      <div className="flex p-2 bg-gray-900 flex-row-reverse">
        <EditorButton
          onClick={() => {
            dispatch({ type: "TOGGLE_EDITOR" });
          }}
          text="Close Editor"
        />
      </div>
      <div
        className="flex grow overflow-hidden relative border-2 border-gray-600"
        ref={gameCanvasContainerRef}
      >
        <div className="absolute top-2 right-2 z-10">
          <div
            className="border-2 border-gray-600 bg-gray-900 overflow-hidden aspect-square"
            style={{ width: "20vw" }}
          >
            <canvas ref={minimapRef} />
          </div>
        </div>
        <VirtualizedCanvasList
          className="content-start absolute box-content flex flex-row flex-wrap top-2 left-2 z-10 border-2 border-gray-600 bg-gray-900 overflow-y-scroll bottom-2"
          style={{ width: coords.TILE_SIZE * (4 * 2 + 2) }}
          canvases={props.editor.tiles}
          items={tiles}
          itemTemplate={TileComponent}
        />
      </div>
    </div>
  ) : (
    <>
      <EditorButton
        className="absolute top-2 right-2 z-10"
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
    { id, isVisible }: { id: string; isVisible: boolean },
    canvasRef: React.ForwardedRef<HTMLCanvasElement>
  ) => {
    return (
      <li
        style={{
          padding: coords.TILE_SIZE / 2 - 2,
        }}
        className="border-2 grow-0 border-gray-900 hover:bg-gray-600 hover:border-white"
      >
        <canvas
          style={{
            width: coords.TILE_SIZE * 4,
            height: coords.TILE_SIZE * 4,
          }}
          ref={canvasRef}
        />
      </li>
    );
  }
);
