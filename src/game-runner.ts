export interface GameContext {
  gl: WebGL2RenderingContext;
  offscreen: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  getGamepad: () => Gamepad | null;
  keys: { [key: string]: boolean };
  mouse: {
    x: number;
    y: number;
    down: Array<boolean>;
    clicked: Array<boolean>;
  };
  touches: {
    down: Map<number, { x: number; y: number }>;
    ended: Map<number, { x: number; y: number }>;
  };
  screen: { width: number; height: number };
}

interface GameProps<T, U> {
  fixedUpdate: number;
  start: (ctx: GameContext, previousState?: U) => Promise<T>;
  saveKey: string;
  save: (state: T) => U;
  update: (ctx: GameContext, state: T, fixedDelta: number) => void;
  draw: (ctx: GameContext, state: T, delta: number) => void;
  screen: { width: number; height: number };
  offscreenCanvas: { width: number; height: number };
}

export default function GameRunner<T, U>(
  props: GameProps<T, U>
): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("width", props.screen.width.toString());
  canvas.setAttribute("height", props.screen.height.toString());
  canvas.style.imageRendering = "pixelated";

  const gl = canvas.getContext("webgl2");

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
    keys: {},
    mouse: {
      x: 0,
      y: 0,
      down: [],
      clicked: [],
    },
    touches: {
      down: new Map<number, { x: number; y: number }>(),
      ended: new Map<number, { x: number; y: number }>(),
    },
    screen: props.screen,
  };

  window.addEventListener("gamepadconnected", (e) => {
    selectedGamepadIndex = e.gamepad.index;
  });
  window.addEventListener("gamepaddisconnected", (_) => {
    selectedGamepadIndex = null;
  });
  window.addEventListener("keydown", (e) => {
    context.keys[e.key] = true;
  });
  window.addEventListener("keyup", (e) => {
    delete context.keys[e.key];
  });
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    context.mouse.x = e.clientX - rect.left;
    context.mouse.y = e.clientY - rect.top;
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
      const newTouch = {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
      if (
        newTouch.x >= 0 &&
        newTouch.y >= 0 &&
        newTouch.x <= context.screen.width &&
        newTouch.y <= context.screen.height
      ) {
        context.touches.down.set(touch.identifier, newTouch);
      }
    }
  });
  canvas.addEventListener("touchmove", (e) => {
    const rect = canvas.getBoundingClientRect();
    for (let i = 0; i < e.changedTouches.length; ++i) {
      const touch = e.changedTouches[i];
      const existingTouch = context.touches.down.get(touch.identifier);
      if (existingTouch) {
        existingTouch.x = touch.clientX - rect.left;
        existingTouch.y = touch.clientY - rect.top;
      }
    }
  });
  canvas.addEventListener("touchend", (e) => {
    const rect = canvas.getBoundingClientRect();
    for (let i = 0; i < e.changedTouches.length; ++i) {
      const touch = e.changedTouches[i];
      const existingTouch = context.touches.down.get(touch.identifier);
      if (existingTouch) {
        existingTouch.x = touch.clientX - rect.left;
        existingTouch.y = touch.clientY - rect.top;
        context.touches.down.delete(touch.identifier);
        context.touches.ended.set(touch.identifier, existingTouch);
      }
    }
  });
  canvas.addEventListener("touchcancel", (e) => {
    for (let i = 0; i < e.changedTouches.length; ++i) {
      const touch = e.changedTouches[i];
      const existingTouch = context.touches.down.get(touch.identifier);
      if (existingTouch) {
        context.touches.down.delete(touch.identifier);
      }
    }
  });

  let lastTime = performance.now();
  let accumulatedTime = 0;
  let nextFrame: number | null = null;

  const saveState = localStorage.getItem(props.saveKey);

  let state: T | null = null;
  props
    .start(context, saveState ? (JSON.parse(saveState) as U) : undefined)
    .then((s) => {
      lastTime = performance.now();
      state = s!;
    })
    .catch((ex) => {
      console.warn(ex);
      // if the saved state fails to load, try again with a fresh state
      props.start(context).then((s) => {
        lastTime = performance.now();
        state = s!;
      });
    });

  const render = () => {
    if (state) {
      const currentTime = performance.now();
      const frameTime = currentTime - lastTime;
      lastTime = currentTime;
      accumulatedTime += frameTime;

      while (accumulatedTime >= props.fixedUpdate) {
        console.log(context.mouse);
        props.update(context, state, props.fixedUpdate);
        context.mouse.clicked = [];
        context.touches.ended.clear();
        accumulatedTime -= props.fixedUpdate;
      }

      props.draw(context, state, frameTime);
    }
    nextFrame = requestAnimationFrame(render);
  };

  nextFrame = requestAnimationFrame(render);

  const handlePersist = () => {
    if (document.visibilityState === "hidden") {
      if (state) {
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
    const multiplier = Math.max(
      1,
      Math.min(
        Math.floor(window.innerWidth / props.screen.width),
        Math.floor(window.innerHeight / props.screen.height)
      )
    );
    if (canvas) {
      canvas.style.width = multiplier * props.screen.width + "px";
      canvas.style.height = multiplier * props.screen.height + "px";
    }
  };

  handleResize();
  window.addEventListener("resize", handleResize);

  return canvas;
}
