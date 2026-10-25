import { ImageElement } from '../types';

export function buildCanvasFilterString(f: ImageElement['filters']): string {
  if (!f) return '';
  const parts: string[] = [];
  if (f.brightness !== undefined && f.brightness !== 100) parts.push(`brightness(${f.brightness}%)`);
  if (f.contrast !== undefined && f.contrast !== 100) parts.push(`contrast(${f.contrast}%)`);
  if (f.saturation !== undefined && f.saturation !== 100) parts.push(`saturate(${f.saturation}%)`);
  if (f.grayscale) parts.push(`grayscale(${f.grayscale}%)`);
  if (f.invert) parts.push(`invert(${f.invert}%)`);
  if (f.blur) parts.push(`blur(${f.blur}px)`);
  return parts.join(' ');
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

/**
 * Decode image src to ImageData (filters applied). Rejects on load/CORS failure.
 */
export async function imageElementToImageData(
  el: ImageElement,
  maxDimension: number
): Promise<{ data: ImageData; sourceWidth: number; sourceHeight: number }> {
  if (!el.src) throw new Error(`Image "${el.name}" has no src`);
  const img = await loadImageElement(el.src);
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  if (!nw || !nh) throw new Error(`Image "${el.name}" has invalid dimensions`);

  let tw = nw;
  let th = nh;
  const maxSide = Math.max(nw, nh);
  if (maxSide > maxDimension) {
    const s = maxDimension / maxSide;
    tw = Math.max(1, Math.round(nw * s));
    th = Math.max(1, Math.round(nh * s));
  }

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get 2d context for vectorize');

  const filterStr = buildCanvasFilterString(el.filters);
  if (filterStr && 'filter' in ctx) ctx.filter = filterStr;

  ctx.drawImage(img, 0, 0, tw, th);
  const data = ctx.getImageData(0, 0, tw, th);
  return { data, sourceWidth: tw, sourceHeight: th };
}

/** Node/tests: raw RGBA buffer → ImageData-like for imagetracerjs */
export function rgbaToImageData(
  width: number,
  height: number,
  rgba: Uint8Array | Uint8ClampedArray | Buffer
): ImageData {
  const clamped =
    rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba as Uint8Array);
  if (typeof ImageData !== 'undefined') {
    return new ImageData(clamped, width, height);
  }
  return { width, height, data: clamped } as ImageData;
}

export function applyAlphaThreshold(imageData: ImageData, threshold: number): void {
  const d = imageData.data;
  const t = Math.max(0, Math.min(255, threshold));
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < t) {
      d[i - 3] = 0;
      d[i - 2] = 0;
      d[i - 1] = 0;
      d[i] = 0;
    }
  }
}
