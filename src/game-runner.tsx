import React, { useRef, useEffect } from "react";

export interface RenderContext {
  gl: WebGL2RenderingContext;
  offscreen: CanvasRenderingContext2D;
}

interface GameProps<T, U> {
  fixedUpdate: number;
  start: (
    ctx: RenderContext,
    world: { width: number; height: number },
    previousState?: U
  ) => Promise<T>;
  saveKey: string;
  save: (state: T) => U;
  update: (ctx: RenderContext, state: T, fixedDelta: number) => void;
  draw: (ctx: RenderContext, state: T, delta: number) => void;
}

const WIDTH = 320;
const HEIGHT = 192;

function GameComponent<T, U>(props: GameProps<T, U>): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current) {
      return;
    }

    const gl = canvasRef.current.getContext("webgl2");

    if (!gl) {
      console.error(
        "Unable to initialize WebGL. Your browser or machine may not support it."
      );
      return;
    }

    const offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = 1024;
    offscreenCanvas.height = 1024;
    const offscreen = offscreenCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!offscreen) {
      console.error(
        "Unable to initialize OffscreenCanvas. Your browser or machine may not support it."
      );
      return;
    }

    const context: RenderContext = {
      gl,
      offscreen,
    };

    let lastTime = performance.now();
    let accumulatedTime = 0;
    let nextFrame: number | null = null;

    const saveState = localStorage.getItem(props.saveKey);

    let state: T | null = null;
    props
      .start(
        context,
        { width: WIDTH, height: HEIGHT },
        saveState ? (JSON.parse(saveState) as U) : undefined
      )
      .then((s) => {
        lastTime = performance.now();
        state = s!;
      })
      .catch((ex) => {
        console.warn(ex);
        // if the saved state fails to load, try again with a fresh state
        props.start(context, { width: WIDTH, height: HEIGHT }).then((s) => {
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
          props.update(context, state, props.fixedUpdate);
          accumulatedTime -= props.fixedUpdate;
        }

        props.draw(context, state, frameTime);
      } else {
        // TODO loading fallback...
      }
      nextFrame = requestAnimationFrame(render);
    };

    nextFrame = requestAnimationFrame(render);

    const handlePersist = () => {
      if (state && document.visibilityState === "hidden") {
        localStorage.setItem(props.saveKey, JSON.stringify(props.save(state)));
      }
    };
    window.addEventListener("visibilitychange", handlePersist);

    return () => {
      if (nextFrame) {
        cancelAnimationFrame(nextFrame);
      }
      window.removeEventListener("visibilitychange", handlePersist);
    };
  }, [props.fixedUpdate, props.update, props.draw, props.save, props.saveKey]);

  useEffect(() => {
    const handleResize = () => {
      const multiplier = Math.max(
        1,
        Math.min(
          Math.floor(window.innerWidth / WIDTH),
          Math.floor(window.innerHeight / HEIGHT)
        )
      );
      if (canvasRef.current) {
        canvasRef.current.style.width = multiplier * WIDTH + "px";
        canvasRef.current.style.height = multiplier * HEIGHT + "px";
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={WIDTH}
      height={HEIGHT}
      style={{ imageRendering: "pixelated" }}
    />
  );
}

export default GameComponent;
