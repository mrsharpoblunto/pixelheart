import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Panel,
  PanelGroup,
  PanelGroupStorage,
  PanelResizeHandle,
} from "react-resizable-panels";

import { EditorContext } from "@pixelheart/api";

import { GameState } from "../../client";
import { EditorActions, EditorEvents, EditorState } from "./";

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

export function EditorComponent(props: EditorClientState) {
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const [state, dispatch] = useReducer(reducer, props);

  useEffect(() => {
    // make sure editor server events are dispatched to the reducer
    props.ctx.editorServer.onEvent((a) => {
      dispatch(a);
    });
  }, [dispatch, props.ctx.editorServer]);

  useEffect(() => {
    if (
      canvasContainerRef.current &&
      props.ctx.canvas.parentElement !== canvasContainerRef.current
    ) {
      if (props.ctx.canvas.parentElement) {
        props.ctx.canvas.parentElement.removeChild(props.ctx.canvas);
      }
      canvasContainerRef.current.appendChild(props.ctx.canvas);
    }
    return () => {
      if (
        canvasContainerRef.current &&
        props.ctx.canvas.parentElement === canvasContainerRef.current
      ) {
        canvasContainerRef.current.removeChild(props.ctx.canvas);
      }
    };
  }, [props.ctx.canvas, state.editor.active]);

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
    <div className="flex grow overflow-hidden" ref={canvasContainerRef}></div>
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
