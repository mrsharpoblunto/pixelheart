import {
  EditorContext,
  GameClient,
  EditorClient,
  EditorAction,
  EditorEvent,
} from "./api";
import { vec4, vec2, ReadonlyVec4 } from "gl-matrix";

interface GameProps<
  State,
  PersistentState,
  EditorState,
  PersistentEditorState,
  Actions extends EditorAction,
  Events extends EditorEvent
> {
  editorSocket: WebSocket | null;
  container: HTMLElement;
  fixedUpdate: number;
  saveKey: string;
  screen: {
    incrementSize: number;
    preferredWidthIncrements: number;
    preferredHeightIncrements: number;
  };
  game: GameClient<State, PersistentState>;
  editor: EditorClient<
    State,
    EditorState,
    PersistentEditorState,
    Actions,
    Events
  > | null;
}

export default function GameRunner<
  State extends Object,
  PersistentState extends Object,
  EditorState extends Object,
  PersistentEditorState extends Object,
  Actions extends EditorAction,
  Events extends EditorEvent
>(
  props: GameProps<
    State,
    PersistentState,
    EditorState,
    PersistentEditorState,
    Actions,
    Events
  >
): {
  canvas: HTMLCanvasElement;
  gameState: State;
  editorState: EditorState | null;
} | null {
  const canvas = document.createElement("canvas");
  canvas.style.imageRendering = "pixelated";

  const gl = canvas.getContext("webgl2", {
    alpha: false,
    premultipliedAlpha: false,
  });

  if (!gl) {
    console.error(
      "Unable to initialize WebGL. Your browser or machine may not support it."
    );
    return null;
  }

  let selectedGamepadIndex: number | null = null;

  const contextScreen = {
    width: 1,
    height: 1,
  };
  const contextSafeScreen = {
    offsetLeft: 0,
    offsetTop: 0,
    width: 1,
    height: 1,
  };

  const socket = props.editorSocket;

  const context: EditorContext<Actions> = {
    gl,
    editor: {
      send: (action: Actions) => {
        socket?.send(JSON.stringify(action));
      },
    },
    createOffscreenCanvas: (
      width: number,
      height: number,
      settings?: CanvasRenderingContext2DSettings
    ) => {
      const offscreenCanvas = document.createElement("canvas");
      offscreenCanvas.width = width;
      offscreenCanvas.height = height;
      const offscreen = offscreenCanvas.getContext("2d", settings);
      if (!offscreen) {
        console.error(
          "Unable to initialize OffscreenCanvas. Your browser or machine may not support it."
        );
      }
      return offscreen!;
    },
    canvas,
    getGamepad: () => {
      if (selectedGamepadIndex !== null) {
        return navigator.getGamepads()[selectedGamepadIndex];
      }
      return null;
    },
    keys: {
      down: new Set<string>(),
      pressed: new Set<string>(),
    },
    mouse: {
      position: vec2.create(),
      wheel: vec2.create(),
      down: [],
      clicked: [],
    },
    touches: {
      down: new Map(),
      ended: new Map(),
    },
    screen: {
      get width(): number {
        return contextScreen.width;
      },
      get height(): number {
        return contextScreen.height;
      },
      safeArea: {
        get width(): number {
          return contextScreen.width;
        },
        get height(): number {
          return contextScreen.height;
        },
        get boundingRect(): vec4 {
          return vec4.fromValues(
            contextSafeScreen.offsetTop,
            contextSafeScreen.offsetLeft + contextSafeScreen.width,
            contextSafeScreen.offsetTop + contextSafeScreen.height,
            contextSafeScreen.offsetLeft
          );
        },
      },
      toScreenSpace: (out: vec4, relativeRect: ReadonlyVec4) =>
        vec4.set(
          out,
          relativeRect[0] / contextScreen.height,
          relativeRect[1] / contextScreen.width,
          relativeRect[2] / contextScreen.height,
          relativeRect[3] / contextScreen.width
        ),
    },
  };

  let pixelMultiplier = 1;

  window.addEventListener("gamepadconnected", (e) => {
    selectedGamepadIndex = e.gamepad.index;
  });
  window.addEventListener("gamepaddisconnected", (_) => {
    selectedGamepadIndex = null;
  });
  window.addEventListener("keydown", (e) => {
    context.keys.down.add(e.key);
    if (e.altKey || e.shiftKey || e.ctrlKey) {
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (context.keys.down.has(e.key)) {
      context.keys.pressed.add(e.key);
    }
    context.keys.down.delete(e.key);
    if (e.altKey || e.shiftKey || e.ctrlKey) {
      e.preventDefault();
    }
  });
  canvas.addEventListener("wheel", (e) => {
    if (e.deltaMode === WheelEvent.DOM_DELTA_PIXEL) {
      vec2.set(context.mouse.wheel, e.deltaX, e.deltaY);
    }
  });
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    vec2.set(
      context.mouse.position,
      (e.clientX - rect.left) / pixelMultiplier,
      (e.clientY - rect.top) / pixelMultiplier
    );
  });
  canvas.addEventListener("mousedown", (e) => {
    context.mouse.down[e.button] = true;
  });
  canvas.addEventListener("mouseup", (e) => {
    if (context.mouse.down[e.button]) {
      context.mouse.clicked[e.button] = true;
    }
    context.mouse.down[e.button] = false;
  });
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });
  canvas.addEventListener("touchstart", (e) => {
    const rect = canvas.getBoundingClientRect();
    for (let i = 0; i < e.changedTouches.length; ++i) {
      const touch = e.changedTouches[i];
      const newTouch = vec2.fromValues(
        (touch.clientX - rect.left) / pixelMultiplier,
        (touch.clientY - rect.top) / pixelMultiplier
      );
      if (
        newTouch[0] >= 0 &&
        newTouch[1] >= 0 &&
        newTouch[0] <= context.screen.width &&
        newTouch[1] <= context.screen.height
      ) {
        context.touches.down.set(touch.identifier, {
          started: Date.now(),
          position: newTouch,
        });
      }
    }
    e.preventDefault();
  });
  canvas.addEventListener("touchmove", (e) => {
    const rect = canvas.getBoundingClientRect();
    for (let i = 0; i < e.changedTouches.length; ++i) {
      const touch = e.changedTouches[i];
      const existingTouch = context.touches.down.get(touch.identifier);
      if (existingTouch) {
        vec2.set(
          existingTouch.position,
          (touch.clientX - rect.left) / pixelMultiplier,
          (touch.clientY - rect.top) / pixelMultiplier
        );
      }
    }
    e.preventDefault();
  });
  canvas.addEventListener("touchend", (e) => {
    const rect = canvas.getBoundingClientRect();
    for (let i = 0; i < e.changedTouches.length; ++i) {
      const touch = e.changedTouches[i];
      const existingTouch = context.touches.down.get(touch.identifier);
      if (existingTouch) {
        vec2.set(
          existingTouch.position,
          (touch.clientX - rect.left) / pixelMultiplier,
          (touch.clientY - rect.top) / pixelMultiplier
        );
        context.touches.down.delete(touch.identifier);
        context.touches.ended.set(touch.identifier, {
          position: existingTouch.position,
        });
      }
    }
    e.preventDefault();
  });
  canvas.addEventListener("touchcancel", (e) => {
    for (let i = 0; i < e.changedTouches.length; ++i) {
      const touch = e.changedTouches[i];
      const existingTouch = context.touches.down.get(touch.identifier);
      if (existingTouch) {
        context.touches.down.delete(touch.identifier);
      }
    }
    e.preventDefault();
  });

  let lastTime = performance.now();

  const startup = () => {
    const saveState = localStorage.getItem(props.saveKey);
    const editorSaveState = localStorage.getItem(`${props.saveKey}-editor`);
    lastTime = performance.now();

    const gameState = (() => {
      try {
        return props.game.onStart(
          context,
          saveState ? (JSON.parse(saveState) as PersistentState) : undefined
        );
      } catch (ex) {
        console.warn(ex);
        return props.game.onStart(context);
      }
    })();

    const editorState = props.editor
      ? (() => {
          try {
            props.editor?.onEnd(props.container);
            return props.editor?.onStart(
              context,
              gameState,
              props.container,
              editorSaveState
                ? (JSON.parse(editorSaveState) as PersistentEditorState)
                : undefined
            );
          } catch (ex) {
            console.warn(ex);
            props.editor?.onEnd(props.container);
            return props.editor?.onStart(context, gameState, props.container);
          }
        })()
      : null;

    return {
      gameState,
      editorState,
    };
  };

  let contextLost = false;
  const result = {
    ...startup(),
    canvas,
  };

  if (props.editor) {
    socket?.addEventListener("message", (e) => {
      if (result.editorState) {
        props.editor?.onEvent(
          context,
          result.gameState,
          result.editorState,
          JSON.parse(e.data) as Events
        );
      }
    });
    socket?.addEventListener("close", () => {
      if (result.editorState) {
        props.editor?.onEvent(context, result.gameState, result.editorState, {
          type: "EDITOR_DISCONNECTED",
        } as Events);
      }
    });
  } else {
    props.container.appendChild(canvas);
  }

  canvas.addEventListener(
    "webglcontextlost",
    (e) => {
      e.preventDefault();
      contextLost = true;
      console.warn("WebGL context lost, saving state...");
      if (result.gameState) {
        localStorage.setItem(
          props.saveKey,
          JSON.stringify(props.game.onSave(result.gameState))
        );
      }
      if (result.editorState && props.editor) {
        localStorage.setItem(
          `${props.saveKey}-editor`,
          JSON.stringify(props.editor.onSave(result.editorState))
        );
      }
    },
    false
  );
  canvas.addEventListener(
    "webglcontextrestored",
    (e) => {
      e.preventDefault();
      context.gl = canvas.getContext("webgl2")!;
      console.warn("WebGL context restored, loading state...");
      // maintain the same object reference, but reload all the properties.
      // of the state. This is necessary so that the editor can refer to the
      // new state as we can't pass in a new reference to the editor.
      Object.keys(result.gameState).forEach((key) => {
        delete result.gameState[key as keyof State];
      });
      if (result.editorState) {
        Object.keys(result.editorState).forEach((key) => {
          delete result.editorState![key as keyof EditorState];
        });
      }
      Object.assign(result, startup());
      contextLost = false;
    },
    false
  );

  let accumulatedTime = 0;
  let nextFrame: number | null = null;
  const render = () => {
    const currentTime = performance.now();
    const frameTime = currentTime - lastTime;
    lastTime = currentTime;
    accumulatedTime += frameTime;

    while (accumulatedTime >= props.fixedUpdate) {
      props.game.onUpdate(context, result.gameState, props.fixedUpdate);
      if (result.editorState) {
        props.editor?.onUpdate(
          context,
          result.gameState,
          result.editorState,
          props.fixedUpdate
        );
      }
      context.mouse.clicked = [];
      vec2.set(context.mouse.wheel, 0, 0);
      context.touches.ended.clear();
      context.keys.pressed.clear();
      accumulatedTime -= props.fixedUpdate;
    }

    if (!contextLost) {
      props.game.onDraw(context, result.gameState, frameTime);
      if (result.editorState) {
        props.editor?.onDraw(
          context,
          result.gameState,
          result.editorState,
          frameTime
        );
      }
    }
    nextFrame = requestAnimationFrame(render);
  };

  nextFrame = requestAnimationFrame(render);

  const handlePersist = () => {
    if (document.visibilityState === "hidden") {
      console.warn("Visibility changing, saving state...");
      const savedState = props.game.onSave(result.gameState);
      if (savedState) {
        localStorage.setItem(props.saveKey, JSON.stringify(savedState));
      }
      if (result.editorState) {
        const savedState = props.editor?.onSave(result.editorState);
        if (savedState) {
          localStorage.setItem(
            `${props.saveKey}-editor`,
            JSON.stringify(savedState)
          );
        }
      }
      if (nextFrame) {
        cancelAnimationFrame(nextFrame);
      }
    } else {
      lastTime = performance.now();
      accumulatedTime = 0;
      nextFrame = requestAnimationFrame(render);
    }
  };
  window.addEventListener("visibilitychange", handlePersist);

  const handleResize = () => {
    // TODO should be using parent container size - not window...
    pixelMultiplier = 1;
    if (props.container.clientWidth >= props.container.clientHeight) {
      contextScreen.width =
        Math.min(
          props.screen.preferredWidthIncrements,
          Math.floor(props.container.clientWidth / props.screen.incrementSize)
        ) * props.screen.incrementSize;
      while (
        contextScreen.width * (pixelMultiplier + 1) <
        props.container.clientWidth
      ) {
        ++pixelMultiplier;
      }
      contextScreen.height =
        Math.floor(
          props.container.clientHeight /
            (props.screen.incrementSize * pixelMultiplier)
        ) * props.screen.incrementSize;
    } else {
      contextScreen.height =
        Math.min(
          props.screen.preferredHeightIncrements,
          Math.floor(props.container.clientHeight / props.screen.incrementSize)
        ) * props.screen.incrementSize;
      while (
        contextScreen.height * (pixelMultiplier + 1) <
        props.container.clientHeight
      ) {
        ++pixelMultiplier;
      }
      contextScreen.width =
        Math.floor(
          props.container.clientWidth /
            (props.screen.incrementSize * pixelMultiplier)
        ) * props.screen.incrementSize;
    }
    while (
      contextScreen.width * pixelMultiplier <
      props.container.clientWidth
    ) {
      contextScreen.width += props.screen.incrementSize;
    }
    while (
      contextScreen.height * pixelMultiplier <
      props.container.clientHeight
    ) {
      contextScreen.height += props.screen.incrementSize;
    }

    const xOffset =
      (contextScreen.width * pixelMultiplier - props.container.clientWidth) / 2;
    const yOffset =
      (contextScreen.height * pixelMultiplier - props.container.clientHeight) /
      2;

    contextSafeScreen.offsetLeft = xOffset;
    contextSafeScreen.offsetTop = yOffset;
    contextSafeScreen.width = contextScreen.width - xOffset * 2;
    contextSafeScreen.height = contextScreen.height - yOffset * 2;

    if (canvas) {
      canvas.setAttribute("width", contextScreen.width.toString());
      canvas.setAttribute("height", contextScreen.height.toString());

      canvas.style.top = -yOffset + "px";
      canvas.style.left = -xOffset + "px";
      canvas.style.width = pixelMultiplier * contextScreen.width + "px";
      canvas.style.height = pixelMultiplier * contextScreen.height + "px";
    }
  };

  handleResize();
  const resizeObserver = new ResizeObserver((entries) => {
    for (let entry of entries) {
      if (entry.target === props.container) {
        handleResize();
      }
    }
  });
  resizeObserver.observe(props.container);

  return result;
}
