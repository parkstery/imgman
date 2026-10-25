/**
 * Auto-Crop / Trim
 * ----------------------------------------------------------------------------
 * 이미지(또는 합성된 캔버스)의 픽셀 데이터를 분석해 "내용이 실제로 존재하는"
 * 최소 사각형(바운딩 박스)을 찾는다.
 *
 * - 투명 배경: alpha > threshold 인 픽셀을 내용으로 판단
 * - 단색 배경(흰색 등): 테두리에서 대표 배경색을 추정한 뒤 색상 거리로 판단
 * - 내용이 전혀 없거나 단색뿐이면 실패 사유를 반환하고 호출측이 기존 범위를 유지
 */
import { CanvasConfig, CanvasElement, Layer, ImageElement } from '../types';
import { generateSVGString } from './svgExport';
import { getContentBounds } from './canvasFit';

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TrimFailureReason = 'empty' | 'uniform' | 'unavailable' | 'error';

export interface TrimOptions {
  /** 색상 허용 오차 0~255 (기본 12). 배경색과 이 값 이하로 차이 나면 배경으로 본다. */
  tolerance?: number;
  /** 알파 임계값 0~254 (기본 8). 이 값 이하의 알파는 투명으로 본다. */
  alphaThreshold?: number;
  /** 'auto'(기본) | 'transparent' | 'color' */
  mode?: 'auto' | 'transparent' | 'color';
  /** mode === 'color' 일 때 사용할 배경색 */
  color?: { r: number; g: number; b: number };
  /** 내용이 없는 것으로 판정할 최대 픽셀 수 비율 (기본 0). 0이면 비활성 */
  minContentRatio?: number;
}

export interface TrimResult {
  ok: boolean;
  /** 픽셀 좌표계(또는 요소 로컬 좌표계) 기준 결과 */
  rect?: CropRect;
  reason?: TrimFailureReason;
  /** 아무것도 잘라낼 수 없었는지 여부 (이미 내용이 꽉 찬 경우) */
  fullFrame?: boolean;
  /** 결과를 만든 방식 */
  source?: 'pixels' | 'vector';
  /** 감지된 배경 종류(디버깅/UI 힌트용) */
  background?: 'transparent' | 'color';
}

const clampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/* -------------------------------------------------------------------------- */
/* 배경색 추정                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 테두리(모서리 + 변 중앙) 샘플을 모아 대표 배경색을 추정한다.
 * 모든 샘플이 투명하면 'transparent', 아니면 최빈 색상을 반환한다.
 */
function detectBackground(
  px: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold: number
): { kind: 'transparent' } | { kind: 'color'; r: number; g: number; b: number } {
  const xs = [0, Math.floor(width / 2), width - 1];
  const ys = [0, Math.floor(height / 2), height - 1];

  let total = 0;
  let opaque = 0;
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();

  for (const y of ys) {
    for (const x of xs) {
      // 모서리/변 중앙만 사용 (내부 9개 전부 쓰면 객체가 닿았을 때 왜곡됨)
      const onBorder = y === 0 || y === height - 1 || x === 0 || x === width - 1;
      if (!onBorder) continue;
      total++;
      const i = (y * width + x) * 4;
      const a = px[i + 3];
      if (a <= alphaThreshold) continue;
      opaque++;
      // 4비트로 양자화해 최빈색을 찾는다 (노이즈/압축 아티팩트 완화)
      const key = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);
      const b = buckets.get(key);
      if (b) {
        b.count++;
        b.r += px[i];
        b.g += px[i + 1];
        b.b += px[i + 2];
      } else {
        buckets.set(key, { count: 1, r: px[i], g: px[i + 1], b: px[i + 2] });
      }
    }
  }

  if (total === 0) return { kind: 'transparent' };
  // 테두리의 절반 이상이 투명하면 투명 배경으로 간주
  if (opaque === 0 || opaque / total < 0.5) return { kind: 'transparent' };

  let best: { count: number; r: number; g: number; b: number } | null = null;
  for (const b of buckets.values()) {
    if (!best || b.count > best.count) best = b;
  }
  if (!best) return { kind: 'transparent' };
  return {
    kind: 'color',
    r: Math.round(best.r / best.count),
    g: Math.round(best.g / best.count),
    b: Math.round(best.b / best.count),
  };
}

/* -------------------------------------------------------------------------- */
/* 핵심 스캔                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * ImageData 에서 내용 영역을 찾는다.
 *
 * 스캔 순서: 위→아래(minY) · 아래→위(maxY) · 좌→우(minX) · 우→좌(maxX)
 * 각 방향에서 첫 내용 픽셀을 만나면 즉시 중단하므로, 여백이 많을수록 빠르다.
 */
export function findTrimBounds(data: ImageData, options: TrimOptions = {}): TrimResult {
  const width = data.width | 0;
  const height = data.height | 0;
  const px = data.data;
  if (width < 1 || height < 1) return { ok: false, reason: 'empty' };

  const tolerance = Math.max(0, Math.min(255, options.tolerance ?? 12));
  const alphaThreshold = Math.max(0, Math.min(254, options.alphaThreshold ?? 8));
  const mode = options.mode ?? 'auto';

  let kind: 'transparent' | 'color' = 'color';
  let bg = { r: 255, g: 255, b: 255 };

  if (mode === 'transparent') {
    kind = 'transparent';
  } else if (mode === 'color' && options.color) {
    kind = 'color';
    bg = options.color;
  } else {
    const detected = detectBackground(px, width, height, alphaThreshold);
    if (detected.kind === 'transparent') {
      kind = 'transparent';
    } else {
      kind = 'color';
      bg = { r: detected.r, g: detected.g, b: detected.b };
    }
  }

  const br = clampByte(bg.r);
  const bgg = clampByte(bg.g);
  const bb = clampByte(bg.b);

  const isContent = (i: number): boolean => {
    if (px[i + 3] <= alphaThreshold) return false;
    if (kind === 'transparent') return true;
    return (
      Math.abs(px[i] - br) > tolerance ||
      Math.abs(px[i + 1] - bgg) > tolerance ||
      Math.abs(px[i + 2] - bb) > tolerance
    );
  };

  const stride = width * 4;

  // 1) minY — 위에서부터 훑어 첫 내용 행을 찾는다
  let minY = -1;
  for (let y = 0; y < height && minY < 0; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      if (isContent(row + x * 4)) {
        minY = y;
        break;
      }
    }
  }
  if (minY < 0) return { ok: false, reason: 'empty', background: kind };

  // 2) maxY — 아래에서부터
  let maxY = -1;
  for (let y = height - 1; y >= minY && maxY < 0; y--) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      if (isContent(row + x * 4)) {
        maxY = y;
        break;
      }
    }
  }
  if (maxY < minY) return { ok: false, reason: 'empty', background: kind };

  // 3) minX — 좌에서부터 (세로 밴드 안에서만 검사)
  let minX = -1;
  for (let x = 0; x < width && minX < 0; x++) {
    for (let y = minY; y <= maxY; y++) {
      if (isContent(y * stride + x * 4)) {
        minX = x;
        break;
      }
    }
  }
  if (minX < 0) return { ok: false, reason: 'empty', background: kind };

  // 4) maxX — 우에서부터
  let maxX = -1;
  for (let x = width - 1; x >= minX && maxX < 0; x--) {
    for (let y = minY; y <= maxY; y++) {
      if (isContent(y * stride + x * 4)) {
        maxX = x;
        break;
      }
    }
  }
  if (maxX < minX) return { ok: false, reason: 'empty', background: kind };

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;

  // 내용이 거의 없는 경우(1~2px 노이즈) 방어
  const minRatio = options.minContentRatio ?? 0;
  if (minRatio > 0 && (w * h) / (width * height) < minRatio) {
    return { ok: false, reason: 'uniform', background: kind };
  }

  return {
    ok: true,
    rect: { x: minX, y: minY, w, h },
    fullFrame: minX === 0 && minY === 0 && w === width && h === height,
    background: kind,
    source: 'pixels',
  };
}

/* -------------------------------------------------------------------------- */
/* 패딩                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 사각형에 여백을 더하고 프레임(0,0,w,h) 안으로 클램프한다.
 * padding 은 px, paddingRatio 는 결과 크기 대비 비율(0~0.5).
 */
export function padRect(
  rect: CropRect,
  padding = 0,
  frame?: { w: number; h: number },
  paddingRatio = 0
): CropRect {
  const pad =
    Math.max(0, padding) +
    Math.round(Math.max(0, Math.min(0.5, paddingRatio)) * Math.max(rect.w, rect.h));

  let x = Math.round(rect.x - pad);
  let y = Math.round(rect.y - pad);
  let w = Math.round(rect.w + pad * 2);
  let h = Math.round(rect.h + pad * 2);

  if (frame) {
    const maxW = Math.round(frame.w);
    const maxH = Math.round(frame.h);
    if (x < 0) {
      w += x;
      x = 0;
    }
    if (y < 0) {
      h += y;
      y = 0;
    }
    if (x + w > maxW) w = maxW - x;
    if (y + h > maxH) h = maxH - y;
  }

  return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
}

/* -------------------------------------------------------------------------- */
/* 픽셀 소스                                                                  */
/* -------------------------------------------------------------------------- */

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

/**
 * 이미지 요소의 원본 픽셀을 읽는다. (표시 필터까지 반영)
 * CORS 로 캔버스가 오염되면 null 을 반환한다.
 */
export async function getImageElementPixels(el: ImageElement): Promise<ImageData | null> {
  try {
    if (!el.src) return null;
    const img = await loadImageElement(el.src);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    const f = el.filters;
    if (f) {
      const parts: string[] = [];
      if (f.brightness !== undefined && f.brightness !== 100) parts.push(`brightness(${f.brightness}%)`);
      if (f.contrast !== undefined && f.contrast !== 100) parts.push(`contrast(${f.contrast}%)`);
      if (f.saturation !== undefined && f.saturation !== 100) parts.push(`saturate(${f.saturation}%)`);
      if (f.grayscale) parts.push(`grayscale(${f.grayscale}%)`);
      if (f.invert) parts.push(`invert(${f.invert}%)`);
      if (f.blur) parts.push(`blur(${f.blur}px)`);
      if (parts.length > 0 && 'filter' in ctx) {
        ctx.filter = parts.join(' ');
      }
    }

    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }
}

/**
 * 캔버스 전체를 배경 투명 상태로 래스터화한 뒤 픽셀을 읽는다.
 * 원격 이미지로 캔버스가 오염되면 null 을 반환한다(호출측은 벡터 폴백 사용).
 */
export async function getCanvasPixels(
  layers: Layer[],
  elements: CanvasElement[],
  config: CanvasConfig
): Promise<ImageData | null> {
  let url = '';
  try {
    const svg = generateSVGString(layers, elements, config, true);
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    url = URL.createObjectURL(blob);
    const img = await loadImageElement(url);

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(config.width));
    canvas.height = Math.max(1, Math.round(config.height));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

/* -------------------------------------------------------------------------- */
/* 고수준 API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 이미지 요소의 자동 자르기 사각형을 요소 로컬 좌표계로 계산한다.
 * (요소가 축소/확대 표시 중이어도 올바른 비율로 환산)
 */
export async function autoCropImageElement(
  el: ImageElement,
  options: TrimOptions = {}
): Promise<TrimResult> {
  const data = await getImageElementPixels(el);
  if (!data) return { ok: false, reason: 'unavailable' };

  const found = findTrimBounds(data, options);
  if (!found.ok || !found.rect) return found;

  const sx = data.width ? el.width / data.width : 1;
  const sy = data.height ? el.height / data.height : 1;
  const rect: CropRect = {
    x: Math.round(found.rect.x * sx),
    y: Math.round(found.rect.y * sy),
    w: Math.max(1, Math.round(found.rect.w * sx)),
    h: Math.max(1, Math.round(found.rect.h * sy)),
  };

  return { ...found, rect };
}

/**
 * 캔버스 전체의 자동 자르기 사각형을 캔버스 좌표계로 계산한다.
 * 픽셀 분석이 불가능하면(오염된 캔버스 등) 벡터 바운딩 박스로 폴백한다.
 */
export async function autoCropCanvas(
  layers: Layer[],
  elements: CanvasElement[],
  config: CanvasConfig,
  options: TrimOptions = {}
): Promise<TrimResult> {
  const data = await getCanvasPixels(layers, elements, config);

  if (data) {
    const found = findTrimBounds(data, { ...options, mode: options.mode ?? 'transparent' });
    if (found.ok) return found;
    // 픽셀이 있는데 내용이 없다면 진짜로 빈 캔버스다 (벡터로 폴백하지 않음)
    if (found.reason === 'empty') return found;
  }

  const vb = getContentBounds(elements, layers, { padding: 0 });
  if (!vb) return { ok: false, reason: data ? 'empty' : 'unavailable' };

  return {
    ok: true,
    rect: {
      x: Math.round(vb.x),
      y: Math.round(vb.y),
      w: Math.max(1, Math.round(vb.w)),
      h: Math.max(1, Math.round(vb.h)),
    },
    fullFrame: false,
    source: 'vector',
  };
}

/** 실패 사유를 사용자 메시지로 변환 */
export function trimFailureMessage(reason?: TrimFailureReason): string {
  switch (reason) {
    case 'empty':
      return '자동 자르기: 내용이 없습니다. 캔버스가 비어 있어 기존 범위를 유지합니다.';
    case 'uniform':
      return '자동 자르기: 단색 영역만 있어 잘라낼 여백을 찾지 못했습니다.';
    case 'unavailable':
      return '자동 자르기: 픽셀을 읽을 수 없어 벡터 경계로 대체했습니다.';
    case 'error':
    default:
      return '자동 자르기: 분석 중 오류가 발생해 기존 범위를 유지합니다.';
  }
}
