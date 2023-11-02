import { vec4, vec2, ReadonlyVec4 } from "gl-matrix";

export interface GameContext {
  gl: WebGL2RenderingContext;
  offscreen: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  getGamepad: () => Gamepad | null;
  keys: {
    down: Set<string>;
    pressed: Set<string>;
  };
  mouse: {
    position: vec2;
    wheel: vec2;
    down: Array<boolean>;
    clicked: Array<boolean>;
  };
  touches: {
    down: Map<number, { started: number, position: vec2}>;
    ended: Map<number, { position: vec2 }>;
  };
  screen: {
    width: number;
    height: number;
    safeArea: {
      width: number;
      height: number;
      boundingRect: vec4;
    };
    toScreenSpace: (out: vec4, relativeRect: ReadonlyVec4) => vec4;
  };
}

interface GameProps<T, U> {
  fixedUpdate: number;
  start: (ctx: GameContext, previousState?: U) => Promise<T>;
  saveKey: string;
  save: (state: T) => U;
  update: (ctx: GameContext, state: T, fixedDelta: number) => void;
  draw: (ctx: GameContext, state: T, delta: number) => void;
  screen: {
    incrementSize: number;
    preferredWidthIncrements: number;
    preferredHeightIncrements: number;
  };
  offscreenCanvas: { width: number; height: number };
}

export default function GameRunner<T, U>(
  props: GameProps<T, U>
): HTMLCanvasElement | null {
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

  const offscreenCanvas = document.createElement("canvas");
  offscreenCanvas.width = props.offscreenCanvas.width;
  offscreenCanvas.height = props.offscreenCanvas.height;
  const offscreen = offscreenCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (!offscreen) {
    console.error(
      "Unable to initialize OffscreenCanvas. Your browser or machine may not support it."
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

  const context: GameContext = {
    gl,
    offscreen,
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
        context.touches.down.set(touch.identifier, { started: Date.now(), position: newTouch});
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
        context.touches.ended.set(touch.identifier, { position: existingTouch.position });
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
  let contextLost = false;
  let state: T | null = null;

  const startup = async () => {
    const saveState = localStorage.getItem(props.saveKey);
    try {
      state = await props.start(
        context,
        saveState ? (JSON.parse(saveState) as U) : undefined
      );
      lastTime = performance.now();
    } catch (ex) {
      console.warn(ex);
      // if the saved state fails to load, try again with a fresh state
      state = await props.start(context);
      lastTime = performance.now();
    }
  };

  canvas.addEventListener(
    "webglcontextlost",
    (e) => {
      e.preventDefault();
      contextLost = true;
      console.warn("WebGL context lost, saving state...");
      if (state) {
        localStorage.setItem(props.saveKey, JSON.stringify(props.save(state)));
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
      startup().then((_) => {
        contextLost = false;
      });
    },
    false
  );

  startup();

  let accumulatedTime = 0;
  let nextFrame: number | null = null;
  const render = () => {
    if (state) {
      const currentTime = performance.now();
      const frameTime = currentTime - lastTime;
      lastTime = currentTime;
      accumulatedTime += frameTime;

      while (accumulatedTime >= props.fixedUpdate) {
        props.update(context, state, props.fixedUpdate);
        context.mouse.clicked = [];
        vec2.set(context.mouse.wheel, 0, 0);
        context.touches.ended.clear();
        context.keys.pressed.clear();
        accumulatedTime -= props.fixedUpdate;
      }

      if (!contextLost) {
        props.draw(context, state, frameTime);
      }
    }
    nextFrame = requestAnimationFrame(render);
  };

  nextFrame = requestAnimationFrame(render);

  const handlePersist = () => {
    if (document.visibilityState === "hidden") {
      if (state) {
        console.warn("Visibility changing, saving state...");
        localStorage.setItem(props.saveKey, JSON.stringify(props.save(state)));
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
    pixelMultiplier = 1;
    if (window.innerWidth >= window.innerHeight) {
      contextScreen.width =
        Math.min(
          props.screen.preferredWidthIncrements,
          Math.floor(window.innerWidth / props.screen.incrementSize)
        ) * props.screen.incrementSize;
      while (contextScreen.width * (pixelMultiplier + 1) < window.innerWidth) {
        ++pixelMultiplier;
      }
      contextScreen.height =
        Math.floor(
          window.innerHeight / (props.screen.incrementSize * pixelMultiplier)
        ) * props.screen.incrementSize;
    } else {
      contextScreen.height =
        Math.min(
          props.screen.preferredHeightIncrements,
          Math.floor(window.innerHeight / props.screen.incrementSize)
        ) * props.screen.incrementSize;
      while (
        contextScreen.height * (pixelMultiplier + 1) <
        window.innerHeight
      ) {
        ++pixelMultiplier;
      }
      contextScreen.width =
        Math.floor(
          window.innerWidth / (props.screen.incrementSize * pixelMultiplier)
        ) * props.screen.incrementSize;
    }
    while (contextScreen.width * pixelMultiplier < window.innerWidth) {
      contextScreen.width += props.screen.incrementSize;
    }
    while (contextScreen.height * pixelMultiplier < window.innerHeight) {
      contextScreen.height += props.screen.incrementSize;
    }

    const xOffset =
      (contextScreen.width * pixelMultiplier - window.innerWidth) / 2;
    const yOffset =
      (contextScreen.height * pixelMultiplier - window.innerHeight) / 2;

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
  window.addEventListener("resize", handleResize);

  return canvas;
}
