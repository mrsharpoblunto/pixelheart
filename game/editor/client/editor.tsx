import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Root } from "react-dom/client";
import {
  Panel,
  PanelGroup,
  PanelGroupStorage,
  PanelResizeHandle,
} from "react-resizable-panels";

import { EditorContext } from "@pixelheart/client";

import { GameState } from "../../client/index.js";
import { EditorActions, EditorEvents, EditorState } from "./index.js";

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

function useExternalCanvas(canvas: HTMLCanvasElement) {
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
  }, [canvas]);

  return canvasContainerRef;
}

function EditorComponent(props: EditorClientState) {
  const [state, dispatch] = useReducer(reducer, props);

  useEffect(() => {
    // make sure editor server events are dispatched to the reducer
    props.ctx.editorServer.onEvent((a) => {
      dispatch(a);
    });
  }, [dispatch, props.ctx.editorServer]);

  const gameCanvasContainerRef = useExternalCanvas(props.ctx.canvas);
  const minimapContainerRef = useExternalCanvas(props.editor.minimap.canvas as HTMLCanvasElement);

  const editorStateStorage: PanelGroupStorage = useMemo(
    () => ({
      getItem(name: string): string | null {
        return state.editor.panels[name];
      },
      setItem(name: string, value: string): void {
        state.editor.panels[name] = value;
      },
    }),
    [state.editor]
  );

  const gameContainer = (
    <div className="flex grow overflow-hidden" ref={gameCanvasContainerRef}></div>
  );

  return state.editor.active ? (
    <div className="flex flex-col grow">
      <div className="flex p-2 bg-gray-900 flex-row-reverse">
        <EditorButton
          onClick={() => {
            dispatch({ type: "TOGGLE_EDITOR" });
          }}
          text="Close Editor"
        />
      </div>
      <PanelGroup
        direction="horizontal"
        autoSaveId="editor"
        storage={editorStateStorage}
        className="bg-gray-900"
      >
        <Panel defaultSize={10} minSize={10} collapsible={true}>
          left
        </Panel>
        <PanelResizeHandle className="p-1 border-1 border-dashed border-color-gray-600 bg-gray-800" />
        <Panel className="flex">{gameContainer}</Panel>
        <PanelResizeHandle className="w-2 bg-gray-800" />
        <Panel defaultSize={20} minSize={20}>
          <div className="flex grow" ref={minimapContainerRef}></div>
          right
        </Panel>
      </PanelGroup>
    </div>
  ) : (
    <>
      <EditorButton
        className="absolute top-0 right-0 z-10 mt-2 mr-2"
        onClick={() => {
          dispatch({ type: "TOGGLE_EDITOR" });
        }}
        text="Open Editor"
      />
      {gameContainer}
    </>
  );
}
