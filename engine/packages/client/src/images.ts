import { GameContext } from "./game.js";
import { SpriteSheetConfig } from "./sprite.js";

export const TEXTURE = Symbol();

export interface GPUTexture {
  [TEXTURE]: WebGLTexture;
  width: number;
  height: number;
}

export interface CPUReadableTexture extends GPUTexture {
  image: HTMLImageElement;
}

function getImageState(): Map<string, Array<(newUrl: string) => void>> | null {
  return process.env.NODE_ENV === "development"
    ? // @ts-ignore
    window.__PIXELHEART_IMAGE_STATE__ ||
    // @ts-ignore
    (window.__PIXELHEART_IMAGE_STATE__ = new Map())
    : null;
}

function registerImage(url: string, reload: (newUrl: string) => void) {
  const devImages = getImageState();
  if (devImages) {
    const index = url.indexOf("?v=");
    const urlKey = url.substring(0, index);
    const images = devImages.get(urlKey);
    if (!images) {
      devImages.set(urlKey, [reload]);
    } else {
      images.push(reload);
    }
  }
}

export function reloadImage(spriteSheet: SpriteSheetConfig) {
  const devImages = getImageState();
  if (devImages) {
    const urls = Object.values(spriteSheet.urls);
    for (let u of urls) {
      const index = u.indexOf("?v=");
      const urlKey = u.substring(0, index);
      const images = devImages.get(urlKey);
      if (images) {
        for (let reload of images) {
          reload(u);
        }
      }
    }
  }
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
  const value = {
    [TEXTURE]: loadTextureFromImage(ctx, image, opts),
    width: image.width,
    height: image.height,
  };

  registerImage(url, (newUrl: string) => {
    loadImageFromUrl(newUrl).then((image) => {
      value[TEXTURE] = loadTextureFromImage(ctx, image, opts);
      value.width = image.width;
      value.height = image.height;
    });
  });
  return value;
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
  const value = {
    image,
    [TEXTURE]: loadTextureFromImage(ctx, image, opts),
    width: image.width,
    height: image.height,
  };

  registerImage(url, (newUrl: string) => {
    loadImageFromUrl(newUrl).then((image) => {
      value.image = image;
      value[TEXTURE] = loadTextureFromImage(ctx, image, opts);
      value.width = image.width;
      value.height = image.height;
    });
  });
  return value;
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });
}

function loadTextureFromImage(
  ctx: GameContext,
  img: HTMLImageElement,
  opts?: {
    filter?: number;
    wrap?: number;
    mipmap?: boolean;
  }
): WebGLTexture {
  const texture = ctx.gl.createTexture();
  ctx.gl.activeTexture(ctx.gl.TEXTURE0);
  ctx.gl.bindTexture(ctx.gl.TEXTURE_2D, texture);
  ctx.gl.pixelStorei(ctx.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
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
    opts?.filter || (opts?.mipmap ? ctx.gl.LINEAR_MIPMAP_LINEAR : ctx.gl.LINEAR)
  );
  ctx.gl.texParameteri(
    ctx.gl.TEXTURE_2D,
    ctx.gl.TEXTURE_MAG_FILTER,
    opts?.filter || (opts?.mipmap ? ctx.gl.LINEAR_MIPMAP_LINEAR : ctx.gl.LINEAR)
  );
  ctx.gl.texImage2D(
    ctx.gl.TEXTURE_2D,
    0,
    ctx.gl.RGBA,
    ctx.gl.RGBA,
    ctx.gl.UNSIGNED_BYTE,
    img
  );
  if (opts?.mipmap) {
    ctx.gl.generateMipmap(ctx.gl.TEXTURE_2D);
  }
  ctx.gl.bindTexture(ctx.gl.TEXTURE_2D, null);
  return texture!;
}

let offscreenPixel: CanvasRenderingContext2D | null = null;

export function getPixelData(
  image: HTMLImageElement
): (x: number, y: number) => Uint8ClampedArray | null {
  if (!offscreenPixel) {
    offscreenPixel = new OffscreenCanvas(image.width, image.height).getContext("2d", {
      willReadFrequently: true,
    }) as unknown as CanvasRenderingContext2D;
  }
  offscreenPixel.canvas.width = Math.max(
    image.width,
    offscreenPixel.canvas.width
  );
  offscreenPixel.canvas.height = Math.max(
    image.height,
    offscreenPixel.canvas.height
  );
  offscreenPixel.drawImage(image, 0, 0, image.width, image.height);

  return (x: number, y: number) => {
    const pixelData = offscreenPixel!.getImageData(x, y, 1, 1).data;
    return pixelData;
  };
}
