import { ImageElement } from '../types';

export type Rect = { x: number; y: number; w: number; h: number };

/** Load an image source into an HTMLImageElement (CORS-friendly for data URLs). */
export function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for edit'));
    img.src = src;
  });
}

/** Intersection of image AABB with a canvas-space region, in image-local display coords. */
export function getImageLocalIntersection(img: ImageElement, region: Rect): Rect | null {
  const left = Math.max(img.x, region.x);
  const top = Math.max(img.y, region.y);
  const right = Math.min(img.x + img.width, region.x + region.w);
  const bottom = Math.min(img.y + img.height, region.y + region.h);
  const w = right - left;
  const h = bottom - top;
  if (w < 1 || h < 1) return null;
  return {
    x: left - img.x,
    y: top - img.y,
    w,
    h,
  };
}

function toNaturalCrop(
  imgElem: ImageElement,
  localCrop: Rect
): { sx: number; sy: number; sw: number; sh: number; naturalW: number; naturalH: number } {
  const naturalW = Math.max(1, Math.round(imgElem.naturalWidth || imgElem.width));
  const naturalH = Math.max(1, Math.round(imgElem.naturalHeight || imgElem.height));
  const scaleX = naturalW / Math.max(1, imgElem.width);
  const scaleY = naturalH / Math.max(1, imgElem.height);

  let sx = Math.round(localCrop.x * scaleX);
  let sy = Math.round(localCrop.y * scaleY);
  let sw = Math.round(localCrop.w * scaleX);
  let sh = Math.round(localCrop.h * scaleY);

  sx = Math.max(0, Math.min(naturalW - 1, sx));
  sy = Math.max(0, Math.min(naturalH - 1, sy));
  sw = Math.max(1, Math.min(naturalW - sx, sw));
  sh = Math.max(1, Math.min(naturalH - sy, sh));

  return { sx, sy, sw, sh, naturalW, naturalH };
}

/** Extract a display-local crop of an image as a PNG data URL. */
export async function extractImageSlice(
  imgElem: ImageElement,
  localCrop: Rect
): Promise<{ src: string; naturalWidth: number; naturalHeight: number }> {
  const { sx, sy, sw, sh } = toNaturalCrop(imgElem, localCrop);
  const img = await loadHtmlImage(imgElem.src);
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d context');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return {
    src: canvas.toDataURL('image/png'),
    naturalWidth: sw,
    naturalHeight: sh,
  };
}

/**
 * Punch a transparent hole in the image bitmap for the given display-local crop.
 * Returns a new ImageElement with updated PNG src (alpha hole).
 */
export async function punchHoleInImageElement(
  imgElem: ImageElement,
  localCrop: Rect
): Promise<ImageElement> {
  const { sx, sy, sw, sh, naturalW, naturalH } = toNaturalCrop(imgElem, localCrop);
  const img = await loadHtmlImage(imgElem.src);
  const canvas = document.createElement('canvas');
  canvas.width = naturalW;
  canvas.height = naturalH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d context');

  ctx.drawImage(img, 0, 0, naturalW, naturalH);
  ctx.clearRect(sx, sy, sw, sh);

  return {
    ...imgElem,
    src: canvas.toDataURL('image/png'),
    naturalWidth: naturalW,
    naturalHeight: naturalH,
  };
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface BackgroundRemovalOptions {
  /** 0-100 color distance tolerance. Defaults to 30. */
  tolerance?: number;
  /** Optional #RGB / #RRGGBB background color. Omitted = auto-detect. */
  backgroundColor?: string | null;
  /** 0-100. Higher values widen the soft alpha ramp at the boundary. */
  feather?: number;
}

export interface ClearBackgroundOptions {
  /** Explicit background color. When omitted, the dominant border color is used. */
  seedColor?: RgbColor | null;
  /** 0-100. Higher values widen the soft alpha ramp at the boundary. */
  feather?: number;
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Parse #RGB / #RRGGBB. Returns null for an invalid value. */
export function parseHexColor(value: string | null | undefined): RgbColor | null {
  if (!value) return null;
  const hex = value.trim().replace(/^#/, '');
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return null;
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHex(color: RgbColor): string {
  const toHex = (n: number) => clampChannel(n).toString(16).padStart(2, '0');
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`.toUpperCase();
}

/**
 * Find the dominant color along the image border.
 * A quantized histogram is much more robust than a plain average when the
 * subject touches an edge or the border contains several colors.
 */
function findDominantBorderColor(
  px: Uint8ClampedArray,
  w: number,
  h: number
): RgbColor | null {
  const BIN_COUNT = 4096;
  const counts = new Uint32Array(BIN_COUNT);
  const sumR = new Float64Array(BIN_COUNT);
  const sumG = new Float64Array(BIN_COUNT);
  const sumB = new Float64Array(BIN_COUNT);

  const sample = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (px[i + 3] <= 16) return;
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const bin = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    counts[bin]++;
    sumR[bin] += r;
    sumG[bin] += g;
    sumB[bin] += b;
  };

  for (let x = 0; x < w; x++) {
    sample(x, 0);
    sample(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    sample(0, y);
    sample(w - 1, y);
  }

  let bestBin = -1;
  let bestCount = 0;
  for (let bin = 0; bin < BIN_COUNT; bin++) {
    if (counts[bin] > bestCount) {
      bestCount = counts[bin];
      bestBin = bin;
    }
  }
  if (bestBin < 0 || bestCount === 0) return null;

  return {
    r: sumR[bestBin] / bestCount,
    g: sumG[bestBin] / bestCount,
    b: sumB[bestBin] / bestCount,
  };
}

/**
 * Pure core of background removal — classifies background pixels IN PLACE.
 * Two-phase: (1) color-key every pixel similar to the seed color,
 * (2) keep only the component CONNECTED to the image border, so same-colored
 * details inside the subject survive. Boundary kept pixels get feathered alpha.
 *
 * The seed is the dominant border color unless a custom color is supplied.
 * Returns the number of cleared pixels, an abort reason, and the seed used.
 */
export function clearBackgroundColorInPlace(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  tolerance: number,
  options: ClearBackgroundOptions = {}
): { removed: number; aborted: string | null; seedColor: RgbColor | null } {
  const total = w * h;
  const t = Math.max(0, Math.min(255, Math.round(tolerance * 2.55)));
  const t2 = 3 * t * t; // hard threshold (squared, summed channels)
  const featherAmount = Math.max(0, Math.min(100, options.feather ?? 50)) / 100;
  const softT = t * (0.75 + featherAmount * 1.5); // soft edge ramp end
  const soft2 = 3 * softT * softT;

  // --- seed color: custom color, or dominant opaque border color -----------
  const seed = options.seedColor ?? findDominantBorderColor(px, w, h);
  if (!seed) {
    return { removed: 0, aborted: 'border-transparent', seedColor: null };
  }
  const sr = seed.r;
  const sg = seed.g;
  const sb = seed.b;

  // --- phase 1: color-key candidates (anywhere in the image) ----------------
  const candidate = new Uint8Array(total);
  for (let idx = 0; idx < total; idx++) {
    const i = idx * 4;
    if (px[i + 3] <= 16) {
      candidate[idx] = 1; // already-transparent pixels expand like background
      continue;
    }
    const dr = px[i] - sr;
    const dg = px[i + 1] - sg;
    const db = px[i + 2] - sb;
    if (dr * dr + dg * dg + db * db <= t2) candidate[idx] = 1;
  }

  // --- phase 2: keep only candidates connected to the border ---------------
  const removed = new Uint8Array(total);
  // Int32Array queue avoids millions of boxed numbers on large screenshots.
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const enqueue = (idx: number) => {
    removed[idx] = 1;
    queue[tail++] = idx;
  };
  const connect = (x: number, y: number) => {
    const idx = y * w + x;
    if (candidate[idx] && !removed[idx]) enqueue(idx);
  };
  for (let x = 0; x < w; x++) {
    connect(x, 0);
    connect(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    connect(0, y);
    connect(w - 1, y);
  }
  while (head < tail) {
    const idx = queue[head++];
    const x = idx % w;
    const y = (idx / w) | 0;
    if (x > 0 && candidate[idx - 1] && !removed[idx - 1]) enqueue(idx - 1);
    if (x < w - 1 && candidate[idx + 1] && !removed[idx + 1]) enqueue(idx + 1);
    if (y > 0 && candidate[idx - w] && !removed[idx - w]) enqueue(idx - w);
    if (y < h - 1 && candidate[idx + w] && !removed[idx + w]) enqueue(idx + w);
  }

  const removedCount = tail;
  if (removedCount === 0) {
    return { removed: 0, aborted: 'no-match', seedColor: seed };
  }
  // Safety: fill must not swallow (almost) the whole image — subject lost
  if (removedCount >= total * 0.985) {
    return { removed: removedCount, aborted: 'flood-everything', seedColor: seed };
  }

  // --- apply: hard-clear removed pixels, feather the boundary band ---------
  for (let idx = 0; idx < total; idx++) {
    if (removed[idx]) {
      px[idx * 4 + 3] = 0;
      continue;
    }
    const x = idx % w;
    const y = (idx / w) | 0;
    const adjacentRemoved =
      (x > 0 && removed[idx - 1]) ||
      (x < w - 1 && removed[idx + 1]) ||
      (y > 0 && removed[idx - w]) ||
      (y < h - 1 && removed[idx + w]);
    if (!adjacentRemoved || soft2 <= t2) continue;
    const i = idx * 4;
    if (px[i + 3] === 0) continue;
    const dr = px[i] - sr;
    const dg = px[i + 1] - sg;
    const db = px[i + 2] - sb;
    const d2 = dr * dr + dg * dg + db * db;
    if (d2 <= soft2) {
      const factor = (d2 - t2) / (soft2 - t2);
      px[i + 3] = Math.round(px[i + 3] * Math.max(0, Math.min(1, factor)));
    }
  }

  return { removed: removedCount, aborted: null, seedColor: seed };
}

/**
 * Remove a (mostly uniform) background from an image by flood-filling from the
 * border inward and clearing matching pixels to transparent.
 *
 * tolerance: 0-100 (0 = exact color only, ~30 = typical anti-aliased edges).
 * Pass a number for backwards compatibility, or an options object to pick a
 * custom background color and edge softness.
 */
export async function removeImageBackground(
  imgElem: ImageElement,
  options: number | BackgroundRemovalOptions = {}
): Promise<{ element: ImageElement; removedPct: number; seedColor: string }> {
  const opts: BackgroundRemovalOptions =
    typeof options === 'number' ? { tolerance: options } : options;
  const tolerance = Math.max(0, Math.min(100, opts.tolerance ?? 30));
  const customSeed = parseHexColor(opts.backgroundColor);

  const naturalW = Math.max(1, Math.round(imgElem.naturalWidth || imgElem.width));
  const naturalH = Math.max(1, Math.round(imgElem.naturalHeight || imgElem.height));
  const img = await loadHtmlImage(imgElem.src);
  const canvas = document.createElement('canvas');
  canvas.width = naturalW;
  canvas.height = naturalH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('캔버스 컨텍스트를 만들 수 없습니다.');
  ctx.drawImage(img, 0, 0, naturalW, naturalH);

  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, naturalW, naturalH);
  } catch {
    throw new Error('보안 정책(CORS)으로 픽셀을 읽을 수 없는 이미지입니다. 파일로 삽입한 이미지를 사용해 보세요.');
  }

  const { removed, aborted, seedColor } = clearBackgroundColorInPlace(
    image.data,
    naturalW,
    naturalH,
    tolerance,
    { seedColor: customSeed, feather: opts.feather }
  );
  const removedPct = Math.round((removed / (naturalW * naturalH)) * 100);

  if (aborted === 'no-match') {
    throw new Error(
      customSeed
        ? '지정한 배경색과 일치하는 영역을 찾지 못했습니다. 색상이나 허용치를 조정해 보세요.'
        : '배경색 후보를 찾지 못했습니다 (제거 대상 0픽셀). 허용치를 높여 보세요.'
    );
  }
  if (aborted === 'border-transparent') {
    throw new Error(
      '이미지 가장자리가 이미 투명합니다. 배경색을 직접 지정하거나, 남은 배경 조각을 크롭한 뒤 다시 시도해 보세요.'
    );
  }
  if (aborted === 'flood-everything') {
    throw new Error(
      `배경과 대상을 구분하지 못했습니다. 허용치(${tolerance}%)를 낮추거나 배경색을 직접 지정해 보세요.`
    );
  }

  ctx.putImageData(image, 0, 0);
  return {
    element: {
      ...imgElem,
      src: canvas.toDataURL('image/png'),
      naturalWidth: naturalW,
      naturalHeight: naturalH,
    },
    removedPct,
    seedColor: seedColor ? rgbToHex(seedColor) : '#000000',
  };
}
