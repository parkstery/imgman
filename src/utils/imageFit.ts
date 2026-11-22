/**
 * 이미지 맞춤(cover / contain) 계산 유틸.
 *
 * 이미지 요소의 박스(el.x/y/width/height) 안에서 원본 비율을 유지한 채
 * 그림이 그려질 사각형을 계산한다. 캔버스 렌더링과 SVG 내보내기가
 * 같은 함수를 사용해 화면/내보내기 결과가 일치한다.
 */

import type { ImageAspectFit } from '../types';

export interface AspectFitOptions {
  fit: ImageAspectFit;
  /** 1 = 기본 배율 */
  zoom: number;
  /** 0 = 좌/상단, 0.5 = 중앙, 1 = 우/하단 */
  focusX: number;
  focusY: number;
}

export interface FitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_ASPECT_FIT_OPTIONS: AspectFitOptions = {
  fit: 'none',
  zoom: 1,
  focusX: 0.5,
  focusY: 0.5,
};

export const IMAGE_ASPECT_ZOOM_MIN = 1;
export const IMAGE_ASPECT_ZOOM_MAX = 4;

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function clampAspectZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(IMAGE_ASPECT_ZOOM_MAX, Math.max(IMAGE_ASPECT_ZOOM_MIN, round3(value)));
}

export function clampAspectFocus(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, round3(value)));
}

export function isImageAspectFit(value: unknown): value is ImageAspectFit {
  return value === 'none' || value === 'cover' || value === 'contain';
}

/** 이미지 요소에 저장된 맞춤 설정을 정규화된 형태로 읽어온다. */
export function resolveImageAspect(el: {
  aspectFit?: ImageAspectFit;
  aspectZoom?: number;
  aspectFocusX?: number;
  aspectFocusY?: number;
}): AspectFitOptions {
  const fit = isImageAspectFit(el.aspectFit) ? el.aspectFit : 'none';
  return {
    fit,
    zoom: fit === 'none' ? 1 : clampAspectZoom(el.aspectZoom ?? 1),
    focusX: fit === 'none' ? 0.5 : clampAspectFocus(el.aspectFocusX ?? 0.5),
    focusY: fit === 'none' ? 0.5 : clampAspectFocus(el.aspectFocusY ?? 0.5),
  };
}

/**
 * 박스 안에서 이미지가 그려질 사각형을 계산한다.
 * - cover: 빈틈 없이 채우고 넘치는 부분은 잘린다.
 * - contain: 전체가 보이도록 맞추고 여백이 남는다.
 * - none: 박스를 그대로 사용한다 (레거시 동작).
 */
export function computeImageFitRect(
  box: { x: number; y: number; width: number; height: number },
  natural: { width: number; height: number },
  options: AspectFitOptions
): FitRect {
  if (options.fit === 'none') {
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }

  const natW = Number.isFinite(natural.width) ? natural.width : 0;
  const natH = Number.isFinite(natural.height) ? natural.height : 0;
  const boxW = Number.isFinite(box.width) ? box.width : 0;
  const boxH = Number.isFinite(box.height) ? box.height : 0;
  if (natW <= 0 || natH <= 0 || boxW <= 0 || boxH <= 0) {
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }

  const baseScale =
    options.fit === 'cover'
      ? Math.max(boxW / natW, boxH / natH)
      : Math.min(boxW / natW, boxH / natH);
  const scale = baseScale * options.zoom;

  const drawW = natW * scale;
  const drawH = natH * scale;
  const overflowX = drawW - boxW;
  const overflowY = drawH - boxH;

  return {
    x: round3(box.x - overflowX * options.focusX),
    y: round3(box.y - overflowY * options.focusY),
    width: round3(drawW),
    height: round3(drawH),
  };
}
