import {RenderContext} from './game-runner';

export interface CPUReadableTexture {
  texture: WebGLTexture,
  image: HTMLImageElement,
  width: number,
  height: number,
}

export function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });
}

export async function loadTextureFromUrl(ctx: RenderContext, url: string): Promise<WebGLTexture> {
  const image = await loadImageFromUrl(url);
  return loadTextureFromImage(ctx, image);
}

export function loadTextureFromImage(ctx: RenderContext, img: HTMLImageElement): WebGLTexture {
  const texture = ctx.gl.createTexture();
  ctx.gl.bindTexture(ctx.gl.TEXTURE_2D, texture);
  ctx.gl.texParameteri(ctx.gl.TEXTURE_2D, ctx.gl.TEXTURE_WRAP_S, ctx.gl.CLAMP_TO_EDGE);
  ctx.gl.texParameteri(ctx.gl.TEXTURE_2D, ctx.gl.TEXTURE_WRAP_T, ctx.gl.CLAMP_TO_EDGE);
  ctx.gl.texParameteri(ctx.gl.TEXTURE_2D, ctx.gl.TEXTURE_MIN_FILTER, ctx.gl.LINEAR);
  ctx.gl.texParameteri(ctx.gl.TEXTURE_2D, ctx.gl.TEXTURE_MAG_FILTER, ctx.gl.LINEAR);
  ctx.gl.texImage2D(ctx.gl.TEXTURE_2D, 0, ctx.gl.RGBA, ctx.gl.RGBA, ctx.gl.UNSIGNED_BYTE, img);
  return texture!;
}

export async function loadCPUReadableTextureFromUrl(ctx:RenderContext, url: string): Promise<CPUReadableTexture> {
  const image = await loadImageFromUrl(url);
  return Promise.resolve({
    image,
    texture: loadTextureFromImage(ctx, image),
    width: image.width,
    height: image.height,
  });
}

export function getPixelData(ctx: RenderContext, image: HTMLImageElement): (x: number, y: number) => (Uint8ClampedArray | null) {
  ctx.offscreen.canvas.width = Math.max(image.width, ctx.offscreen.canvas.width);
  ctx.offscreen.canvas.height = Math.max(image.height, ctx.offscreen.canvas.height);
  ctx.offscreen.drawImage(image, 0, 0, image.width, image.height);

  return (x: number, y: number) => {
    const pixelData = ctx.offscreen.getImageData(x, y, 1, 1).data;
    return pixelData;
  }
}
