import { ReadonlyVec4, vec2, vec4 } from "gl-matrix";
import {
  BaseActions,
  BaseEvents,
  ClientEditorConnection,
  EditorClient,
  EditorContext,
} from "./editor.js";
import { Quad } from "./geometry.js";
import { GameClient } from "./game.js";
import { FrameBuffer, GBuffer, reloadShader } from "./gl-utils.js";
import { reloadImage } from "./images.js";
import { reloadSprite } from "./sprite.js";
import { ShaderProgram } from "./gl-utils.js";


const QuadVert: {
  src: string;
  name: string;
  inAttributes: { a_position: { type: "vec2" } };
  outAttributes: { v_texCoord: { type: "vec2" } };
  uniforms: {};
} = {
  src: `#version 300 es
in vec2 a_position;
out vec2 v_texCoord;
void main() {
  v_texCoord = a_position;
  gl_Position = vec4(a_position * 2.0 - 1.0, 0.0, 1.0);
}`,
  name: "quad.vert",
  inAttributes: { a_position: { type: "vec2" } },
  outAttributes: { v_texCoord: { type: "vec2" } },
  uniforms: {},
}

const BackBufferFrag: {
  src: string;
  name: string;
  inAttributes: { v_texCoord: { type: "vec2" } };
  outAttributes: { outColor: { type: "vec4" } };
  uniforms: { u_texture: "sampler2D" };
} = {
  src: `#version 300 es
precision mediump float;
in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 outColor;
void main() {
  outColor = texture(u_texture, v_texCoord);
}`,
  name: "backbuffer.frag",
  inAttributes: { v_texCoord: { type: "vec2" } },
  outAttributes: { outColor: { type: "vec4" } },
  uniforms: { u_texture: "sampler2D" },
}

interface GameProps<
  State,
  PersistentState,
  EditorState,
  PersistentEditorState,
  Actions extends BaseActions,
  Events extends BaseEvents
> {
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
  Actions extends BaseActions,
  Events extends BaseEvents
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
  let game = props.game;
  const editor = props.editor;
  const canvas = document.createElement("canvas");
  canvas.style.position = "relative";

  const target = canvas.getContext("bitmaprenderer") as ImageBitmapRenderingContext;
  const renderer = new Renderer();

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

  let selectedGamepadIndex: number | null = null;

  const context: EditorContext<Actions, Events> = {
    gl: renderer.gl,
    editorServer: new ClientEditorConnection(),
    createRenderTarget: (width: number, height: number) => {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      return c.getContext("bitmaprenderer") as ImageBitmapRenderingContext;
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
        return game.onStart(
          context,
          saveState ? (JSON.parse(saveState) as PersistentState) : undefined
        );
      } catch (ex) {
        console.warn(ex);
        return game.onStart(context);
      }
    })();

    const editorState = editor
      ? (() => {
        try {
          editor?.onEnd(props.container);
          return editor?.onStart(
            context,
            gameState,
            props.container,
            editorSaveState
              ? (JSON.parse(editorSaveState) as PersistentEditorState)
              : undefined
          );
        } catch (ex) {
          console.warn(ex);
          editor?.onEnd(props.container);
          return editor?.onStart(context, gameState, props.container);
        }
      })()
      : null;

    return {
      gameState,
      editorState,
    };
  };

  context.editorServer.onEvent((e) => {
    switch (e.type) {
      case "RELOAD_SHADER": {
        reloadShader(e.shader, e.src);
        break;
      }
      case "RELOAD_SPRITESHEET": {
        reloadImage(e.spriteSheet);
        reloadSprite(e.spriteSheet);
        break;
      }
      case "RELOAD_STATIC": {
        const links = document.head.querySelectorAll("link");
        for (let l of links) {
          const href = l.getAttribute("href");
          const hrefBase = href?.split("?")[0];
          const match = hrefBase ? e.resources[hrefBase] : null;
          if (match && href !== match) {
            console.log(`Reloading stylesheet ${hrefBase}...`);
            const newLink = document.createElement("link");
            newLink.rel = "stylesheet";
            newLink.href = match;
            newLink.onload = () => {
              document.head.removeChild(l);
            };
            document.head.appendChild(newLink);
          }
        }
      }
    }
  });
  if (editor) {
    let v = 1;
    new EventSource("/esbuild").addEventListener("change", (e) => {
      const message = JSON.parse(e.data);
      if (message.updated.find((f: string) => f === "/js/entrypoint.js")) {
        console.log("Saving state before reloading game plugin...");
        const savedState = game.onSave(result.gameState);
        if (savedState) {
          localStorage.setItem(props.saveKey, JSON.stringify(savedState));
        }
        import("/js/entrypoint.js?v=" + v++).then((module) => {
          game = module.createGameClient();
          console.log("Reloaded game plugin.");
        });
      }
    });
  }

  let contextLost = false;
  const result = {
    ...startup(),
    canvas,
  };

  canvas.addEventListener(
    "webglcontextlost",
    (e) => {
      e.preventDefault();
      contextLost = true;
      console.warn("WebGL context lost, saving state...");
      if (result.gameState) {
        localStorage.setItem(
          props.saveKey,
          JSON.stringify(game.onSave(result.gameState))
        );
      }
      if (result.editorState && editor) {
        localStorage.setItem(
          `${props.saveKey}-editor`,
          JSON.stringify(editor.onSave(result.editorState))
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

  let currentParent: HTMLElement | null = canvas.parentElement;

  let accumulatedTime = 0;
  let nextFrame: number | null = null;

  const renderToTarget = (renderTarget: ImageBitmapRenderingContext, callback: () => void) => {
    const width = renderTarget.canvas.width;
    const height = renderTarget.canvas.height;
    renderTarget.transferFromImageBitmap(renderer.use({ width, height }, callback));
  };

  const render = () => {
    if (currentParent) {
      const currentTime = performance.now();
      const frameTime = currentTime - lastTime;
      lastTime = currentTime;
      accumulatedTime += frameTime;

      while (accumulatedTime >= props.fixedUpdate) {
        game.onUpdate(context, result.gameState, props.fixedUpdate);
        if (result.editorState) {
          editor?.onUpdate(
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
        const scene = renderer.useScaled(context.screen, pixelMultiplier, () => {
          game.onDraw(context, result.gameState, frameTime);
          if (result.editorState) {
            editor?.onDraw(
              context,
              result.gameState,
              result.editorState,
              frameTime
            );
          }
        });
        target.transferFromImageBitmap(scene);
        if (result.editorState) {
          editor?.onDrawExtra(context, result.gameState, result.editorState, frameTime, renderToTarget);
        }
      }
    }
    nextFrame = requestAnimationFrame(render);
  };

  nextFrame = requestAnimationFrame(render);

  const handlePersist = () => {
    if (document.visibilityState === "hidden") {
      console.warn("Visibility changing, saving state...");
      const savedState = game.onSave(result.gameState);
      if (savedState) {
        localStorage.setItem(props.saveKey, JSON.stringify(savedState));
      }
      if (result.editorState) {
        const savedState = editor?.onSave(result.editorState);
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
    const parent = canvas.parentElement || props.container;
    pixelMultiplier = 1;
    if (parent.clientWidth >= parent.clientHeight) {
      contextScreen.width =
        Math.min(
          props.screen.preferredWidthIncrements,
          Math.floor(parent.clientWidth / props.screen.incrementSize)
        ) * props.screen.incrementSize;
      while (contextScreen.width * (pixelMultiplier + 1) < parent.clientWidth) {
        ++pixelMultiplier;
      }
      contextScreen.height =
        Math.floor(
          parent.clientHeight / (props.screen.incrementSize * pixelMultiplier)
        ) * props.screen.incrementSize;
    } else {
      contextScreen.height =
        Math.min(
          props.screen.preferredHeightIncrements,
          Math.floor(parent.clientHeight / props.screen.incrementSize)
        ) * props.screen.incrementSize;
      while (
        contextScreen.height * (pixelMultiplier + 1) <
        parent.clientHeight
      ) {
        ++pixelMultiplier;
      }
      contextScreen.width =
        Math.floor(
          parent.clientWidth / (props.screen.incrementSize * pixelMultiplier)
        ) * props.screen.incrementSize;
    }
    while (contextScreen.width * pixelMultiplier < parent.clientWidth) {
      contextScreen.width += props.screen.incrementSize;
    }
    while (contextScreen.height * pixelMultiplier < parent.clientHeight) {
      contextScreen.height += props.screen.incrementSize;
    }

    const xOffset =
      (contextScreen.width * pixelMultiplier - parent.clientWidth) / (2 * pixelMultiplier);
    const yOffset =
      (contextScreen.height * pixelMultiplier - parent.clientHeight) / (2 * pixelMultiplier);

    contextSafeScreen.offsetLeft = xOffset;
    contextSafeScreen.offsetTop = yOffset;
    contextSafeScreen.width = contextScreen.width - xOffset * 2;
    contextSafeScreen.height = contextScreen.height - yOffset * 2;

    canvas.style.top = -(pixelMultiplier * yOffset) + "px";
    canvas.style.left = -(pixelMultiplier * xOffset) + "px";
    canvas.style.width = pixelMultiplier * contextScreen.width + "px";
    canvas.style.height = pixelMultiplier * contextScreen.height + "px";
  };

  const resizeObserver = new ResizeObserver((entries) => {
    for (let entry of entries) {
      if (entry.target === currentParent) {
        handleResize();
      }
    }
  });

  setInterval(() => {
    const newParent = canvas.parentElement;
    if (newParent != currentParent) {
      if (currentParent) {
        resizeObserver.unobserve(currentParent);
      }
      currentParent = newParent;
      if (currentParent) {
        // once its added to the DOM, we can set the initial size relative
        // to the parent container and can start listening for resize events.
        handleResize();
        resizeObserver.observe(currentParent);
      }
    }
  }, 100);

  if (!result.editorState) {
    props.container.appendChild(canvas);
  }

  return result;
}

class Renderer {
  gl: WebGL2RenderingContext;
  #gBuffer: GBuffer<"color">;
  #quad: Quad;
  #backBufferProgram: ShaderProgram<typeof QuadVert, typeof BackBufferFrag>;
  #frameBuffer: FrameBuffer<{
    outAttributes: { o_color: { type: "vec4", location: 0 } },
  }> | null;
  #offscreenCanvas: OffscreenCanvas;

  constructor() {
    this.#frameBuffer = null;
    this.#offscreenCanvas = new OffscreenCanvas(1, 1);

    this.gl = this.#offscreenCanvas.getContext("webgl2", {
      alpha: false,
      premultipliedAlpha: false,
    }) as WebGL2RenderingContext;

    if (!this.gl) {
      console.error(
        "Unable to initialize WebGL. Your browser or machine may not support it."
      );
    }

    this.#gBuffer = new GBuffer(this.gl, {
      color: {
        internalFormat: this.gl.RGBA,
        format: this.gl.RGBA,
        type: this.gl.UNSIGNED_BYTE,
        opts: {
          filter: this.gl.NEAREST
        }
      },
    });
    this.#quad = new Quad(this.gl);
    this.#backBufferProgram = new ShaderProgram(this.gl, QuadVert, BackBufferFrag);
  }

  useScaled(
    { width, height }: { width: number, height: number },
    pixelMultiplier: number,
    cb: () => void
  ): ImageBitmap {
    this.#offscreenCanvas.width = width * pixelMultiplier;
    this.#offscreenCanvas.height = height * pixelMultiplier;
    const { color } = this.#gBuffer.use({ width, height }, (textures) => {
      this.#frameBuffer = new FrameBuffer(this.gl, {
        outAttributes: { o_color: { type: "vec4", location: 0 } },
      }, {
        o_color: textures.color,
      });
    });
    this.gl.viewport(0, 0, width, height);
    this.#frameBuffer!.bind(cb);
    this.gl.viewport(0, 0, width * pixelMultiplier, height * pixelMultiplier);
    this.#backBufferProgram.use((s) => {
    s.setUniforms({ u_texture: color });
      this.#quad.bind(
        s,
        { position: "a_position" },
        (q) => q.draw()
      );
    });
    return this.#offscreenCanvas.transferToImageBitmap();
  }

  use({ width, height }: { width: number, height: number }, cb: () => void): ImageBitmap {
    this.#offscreenCanvas.width = width;
    this.#offscreenCanvas.height = height;
    this.gl.viewport(0, 0, width, height);
    cb();
    return this.#offscreenCanvas.transferToImageBitmap();
  }


}
