import { ImageElement } from '../types';
import { serializeSafeSvgColor } from './safeSvgColor';

/** Deterministic 32-bit hash (djb2 variant) for id suffixes */
function hashIdSuffix(raw: string): string {
  let h = 5381;
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** XML id / url(#...) fragment — project ids may contain unsafe characters */
export function sanitizeSvgXmlId(rawId: string): string {
  const raw = rawId || 'img';
  let base = raw
    .replace(/[^\w.-]/g, '_')
    .replace(/^[^a-zA-Z_]/, '_');
  if (!base) base = '_img';
  return `${base}_${hashIdSuffix(raw)}`;
}

/** @deprecated use serializeSafeSvgColor */
export function normalizeSvgStrokeColor(c: string): string {
  return serializeSafeSvgColor(c);
}

export interface VectorizedImageMarkupInput {
  elementId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipH?: boolean;
  flipV?: boolean;
  opacity: number;
  cornerRadius?: number;
  borderWidth?: number;
  borderColor?: string;
  traceWidth: number;
  traceHeight: number;
  fragment: string;
  fmt: (n: number) => string;
}

/**
 * F * R on outer group, then T * S on inner (translate x,y then scale to element size).
 * Border and clip share the translated local box (0..width, 0..height).
 */
export function buildVectorizedImageMarkup(input: VectorizedImageMarkupInput): string {
  const {
    elementId,
    x,
    y,
    width,
    height,
    rotation,
    flipH,
    flipV,
    opacity,
    cornerRadius,
    borderWidth,
    borderColor,
    traceWidth,
    traceHeight,
    fragment,
    fmt,
  } = input;

  const safeId = sanitizeSvgXmlId(elementId);
  const cx = x + width / 2;
  const cy = y + height / 2;

  let outerParts = '';
  if (flipH || flipV) {
    const sxFlip = flipH ? -1 : 1;
    const syFlip = flipV ? -1 : 1;
    outerParts += `translate(${fmt(cx)} ${fmt(cy)}) scale(${sxFlip} ${syFlip}) translate(${fmt(-cx)} ${fmt(-cy)}) `;
  }
  if (rotation) {
    outerParts += `rotate(${fmt(rotation)} ${fmt(cx)} ${fmt(cy)})`;
  }
  const outerTransform = outerParts.trim();

  const sx = width / traceWidth;
  const sy = height / traceHeight;
  const clipAttr =
    cornerRadius && cornerRadius > 0 ? ` clip-path="url(#clip-img-${safeId})"` : '';
  const opacityAttr = opacity !== 1 ? ` opacity="${fmt(opacity)}"` : '';

  let inner = `<g transform="translate(${fmt(x)} ${fmt(y)})"${clipAttr}${opacityAttr}>`;
  inner += `<g transform="scale(${fmt(sx)} ${fmt(sy)})">${fragment}</g>`;
  if (borderWidth && borderWidth > 0) {
    const rx = cornerRadius ? fmt(cornerRadius) : '0';
    const stroke = serializeSafeSvgColor(borderColor || '#000000');
    inner += `<rect x="0" y="0" width="${fmt(width)}" height="${fmt(height)}" rx="${rx}" ry="${rx}" fill="none" stroke="${stroke}" stroke-width="${fmt(borderWidth)}" />`;
  }
  inner += '</g>';

  if (outerTransform) {
    return `<g transform="${outerTransform}">${inner}</g>`;
  }
  return inner;
}

export function imageElementToMarkupInput(
  el: ImageElement,
  fragment: string,
  traceWidth: number,
  traceHeight: number,
  fmt: (n: number) => string
): VectorizedImageMarkupInput {
  return {
    elementId: el.id,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    rotation: el.rotation || 0,
    flipH: el.flipH,
    flipV: el.flipV,
    opacity: el.opacity,
    cornerRadius: el.cornerRadius,
    borderWidth: el.borderWidth,
    borderColor: el.borderColor,
    traceWidth,
    traceHeight,
    fragment,
    fmt,
  };
}

/** Detect incorrect single-group translate+rotate ordering (legacy bug). */
export function hasLegacyVectorizedTransformOrder(markup: string, x: number, y: number): boolean {
  const xEsc = String(x).replace('.', '\\.');
  const re = new RegExp(`transform="[^"]*translate\\(${xEsc}[ ,][^"]*rotate`, 'i');
  return re.test(markup);
}
