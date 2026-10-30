import { CanvasElement, ImageElement, Point } from '../types';
import { canvasToLocal, localToCanvas } from './elementGeometry';
import { loadHtmlImage } from './imageEdit';

export type LassoAction = 'copy' | 'cut' | 'duplicate' | 'erase';

export type Rect = { x: number; y: number; w: number; h: number };

export function polygonBounds(poly: Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Integer bounds of the polygon clipped to the canvas, or null if nothing is left. */
export function clippedPolygonBounds(poly: Point[], canvasW: number, canvasH: number): Rect | null {
  const b = polygonBounds(poly);
  const x0 = Math.max(0, Math.floor(b.x));
  const y0 = Math.max(0, Math.floor(b.y));
  const x1 = Math.min(canvasW, Math.ceil(b.x + b.w));
  const y1 = Math.min(canvasH, Math.ceil(b.y + b.h));
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Even-odd ray casting */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Twice the signed area; ~0 means the outline encloses nothing */
export function polygonArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return Math.abs(a) / 2;
}

/** Drop points closer than `minDist` to the previous kept one. */
export function simplifyPolygon(poly: Point[], minDist: number): Point[] {
  if (poly.length < 3) return poly.slice();
  const out: Point[] = [poly[0]];
  for (let i = 1; i < poly.length; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(poly[i].x - last.x, poly[i].y - last.y) >= minDist) out.push(poly[i]);
  }
  return out;
}

function elementCorners(el: CanvasElement): Point[] {
  return [
    { x: 0, y: 0 },
    { x: el.width, y: 0 },
    { x: el.width, y: el.height },
    { x: 0, y: el.height },
  ].map((p) => localToCanvas(el, p));
}

/** Every corner of the (rotated) bbox lies inside the outline. */
export function isElementInsidePolygon(el: CanvasElement, poly: Point[]): boolean {
  return elementCorners(el).every((c) => pointInPolygon(c, poly));
}

/** Coarse overlap test between the element's rotated bbox and the outline bounds. */
export function elementTouchesRect(el: CanvasElement, r: Rect): boolean {
  const cs = elementCorners(el);
  const minX = Math.min(...cs.map((c) => c.x));
  const maxX = Math.max(...cs.map((c) => c.x));
  const minY = Math.min(...cs.map((c) => c.y));
  const maxY = Math.max(...cs.map((c) => c.y));
  return maxX > r.x && minX < r.x + r.w && maxY > r.y && minY < r.y + r.h;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

/**
 * Keep only the pixels inside the outline. `region` is where `dataUrl`
 * sits on the canvas; the polygon is in canvas coordinates.
 */
export async function maskDataUrlWithPolygon(
  dataUrl: string,
  region: Rect,
  poly: Point[]
): Promise<{ dataUrl: string; blob: Blob | null }> {
  const img = await loadHtmlImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || Math.round(region.w);
  canvas.height = img.naturalHeight || Math.round(region.h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d context');
  const sx = canvas.width / region.w;
  const sy = canvas.height / region.h;
  ctx.beginPath();
  poly.forEach((p, i) => {
    const x = (p.x - region.x) * sx;
    const y = (p.y - region.y) * sy;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/png'), blob: await canvasToBlob(canvas) };
}

/**
 * Make the outline transparent inside an image's own bitmap. Works for
 * rotated, flipped and scaled images.
 */
export async function punchPolygonInImageElement(
  imgElem: ImageElement,
  poly: Point[]
): Promise<ImageElement> {
  const img = await loadHtmlImage(imgElem.src);
  const naturalW = img.naturalWidth || imgElem.naturalWidth;
  const naturalH = img.naturalHeight || imgElem.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = naturalW;
  canvas.height = naturalH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d context');
  ctx.drawImage(img, 0, 0, naturalW, naturalH);

  const sx = naturalW / Math.max(1, imgElem.width);
  const sy = naturalH / Math.max(1, imgElem.height);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  poly.forEach((p, i) => {
    const local = canvasToLocal(imgElem, p);
    const x = local.x * sx;
    const y = local.y * sy;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();

  return {
    ...imgElem,
    src: canvas.toDataURL('image/png'),
    naturalWidth: naturalW,
    naturalHeight: naturalH,
  };
}
