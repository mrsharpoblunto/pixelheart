import { GameContext } from "./game-runner";

export const TEXTURE = Symbol();

export interface GPUTexture {
  [TEXTURE]: WebGLTexture;
  width: number;
  height: number;
}

export interface CPUReadableTexture extends GPUTexture {
  image: HTMLImageElement;
}

export function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });
}

export async function loadTextureFromUrl(
  ctx: GameContext,
  url: string,
  opts?: {
    filter?: number;
    wrap?: number;
  }
): Promise<GPUTexture> {
  const image = await loadImageFromUrl(url);
  return {
    [TEXTURE]: loadTextureFromImage(ctx, image, opts),
    width: image.width,
    height: image.height,
  };
}

export async function loadCPUReadableTextureFromUrl(
  ctx: GameContext,
  url: string,
  opts?: {
    filter?: number;
    wrap?: number;
  }
): Promise<CPUReadableTexture> {
  const image = await loadImageFromUrl(url);
  return {
    image,
    [TEXTURE]: loadTextureFromImage(ctx, image, opts),
    width: image.width,
    height: image.height,
  };
}

export function loadTextureFromImage(
  ctx: GameContext,
  img: HTMLImageElement,
  opts?: {
    filter?: number;
    wrap?: number;
  }
): WebGLTexture {
  const texture = ctx.gl.createTexture();
  ctx.gl.activeTexture(ctx.gl.TEXTURE0);
  ctx.gl.bindTexture(ctx.gl.TEXTURE_2D, texture);
  ctx.gl.texParameteri(
    ctx.gl.TEXTURE_2D,
    ctx.gl.TEXTURE_WRAP_S,
    opts?.wrap || ctx.gl.CLAMP_TO_EDGE
  );
  ctx.gl.texParameteri(
    ctx.gl.TEXTURE_2D,
    ctx.gl.TEXTURE_WRAP_T,
    opts?.wrap || ctx.gl.CLAMP_TO_EDGE
  );
  ctx.gl.texParameteri(
    ctx.gl.TEXTURE_2D,
    ctx.gl.TEXTURE_MIN_FILTER,
    opts?.wrap || ctx.gl.LINEAR
  );
  ctx.gl.texParameteri(
    ctx.gl.TEXTURE_2D,
    ctx.gl.TEXTURE_MAG_FILTER,
    opts?.wrap || ctx.gl.LINEAR
  );
  ctx.gl.texImage2D(
    ctx.gl.TEXTURE_2D,
    0,
    ctx.gl.RGBA,
    ctx.gl.RGBA,
    ctx.gl.UNSIGNED_BYTE,
    img
  );
  ctx.gl.bindTexture(ctx.gl.TEXTURE_2D, null);
  return texture!;
}

export function getPixelData(
  ctx: GameContext,
  image: HTMLImageElement
): (x: number, y: number) => Uint8ClampedArray | null {
  ctx.offscreen.canvas.width = Math.max(
    image.width,
    ctx.offscreen.canvas.width
  );
  ctx.offscreen.canvas.height = Math.max(
    image.height,
    ctx.offscreen.canvas.height
  );
  ctx.offscreen.drawImage(image, 0, 0, image.width, image.height);

  return (x: number, y: number) => {
    const pixelData = ctx.offscreen.getImageData(x, y, 1, 1).data;
    return pixelData;
  };
}
