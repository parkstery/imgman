import { CanvasElement } from '../types';

/**
 * The point an element is rotated around, relative to its top-left corner.
 *
 * Straight lines and arrow lines rotate around their START point, every
 * other element around the centre of its bounding box.
 *
 * The canvas renderer, the SVG export and the radial array placement must all
 * agree on this – otherwise rotated elements drift away from where they were
 * placed.
 */
export function getRotationPivot(el: CanvasElement): { x: number; y: number } {
  if (
    el.type === 'shape' &&
    (el.shapeType === 'line' || el.shapeType.startsWith('line-arrow'))
  ) {
    return { x: 0, y: el.height / 2 };
  }
  return { x: el.width / 2, y: el.height / 2 };
}

/** `getRotationPivot` formatted for an SVG `rotate(angle cx cy)` attribute. */
export function getRotationOriginAttr(el: CanvasElement): string {
  const p = getRotationPivot(el);
  return `${p.x} ${p.y}`;
}

/**
 * Map a point from element-local space (relative to x/y, before rotation and
 * flip) to canvas space. Mirrors the renderer: rotate about the pivot, then
 * flip about the bbox centre.
 */
export function localToCanvas(el: CanvasElement, p: { x: number; y: number }): { x: number; y: number } {
  const pv = getRotationPivot(el);
  const cx = el.width / 2;
  const cy = el.height / 2;
  const rad = ((el.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const lx = p.x - pv.x;
  const ly = p.y - pv.y;
  const qx = pv.x - cx + lx * cos - ly * sin;
  const qy = pv.y - cy + lx * sin + ly * cos;
  return {
    x: el.x + cx + (el.flipH ? -qx : qx),
    y: el.y + cy + (el.flipV ? -qy : qy),
  };
}

/** Inverse of `localToCanvas`. */
export function canvasToLocal(el: CanvasElement, p: { x: number; y: number }): { x: number; y: number } {
  const pv = getRotationPivot(el);
  const cx = el.width / 2;
  const cy = el.height / 2;
  const rad = ((el.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let qx = p.x - el.x - cx;
  let qy = p.y - el.y - cy;
  if (el.flipH) qx = -qx;
  if (el.flipV) qy = -qy;
  const lx = qx - pv.x + cx;
  const ly = qy - pv.y + cy;
  return {
    x: pv.x + lx * cos + ly * sin,
    y: pv.y - lx * sin + ly * cos,
  };
}
