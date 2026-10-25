import { CanvasConfig, CanvasElement, Layer, ShapeElement, ImageElement } from '../types';
import { getShapePath, getPolylinePath, getArcPath } from './shapeGenerators';
import { getRotationOriginAttr } from './elementGeometry';

/** Douglas-Peucker 알고리즘으로 포인트 단순화 (허용 오차 px) */
export function simplifyPoints(points: { x: number; y: number }[], tolerance = 1.5): { x: number; y: number }[] {
  if (points.length <= 2) return points;

  // 반복적 구현으로 스택 오버플로 방지
  const markers = new Array(points.length).fill(false);
  markers[0] = true;
  markers[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;

    let maxDist = 0;
    let index = 0;

    const x1 = points[first].x;
    const y1 = points[first].y;
    const x2 = points[last].x;
    const y2 = points[last].y;

    // 선분 거리 계산 (점-직선 거리)
    for (let i = first + 1; i < last; i++) {
      if (markers[i]) continue;
      // 점 (xi, yi)에서 선분 (x1,y1)-(x2,y2)까지의 거리
      const A = y2 - y1;
      const B = x1 - x2;
      const C = x2 * y1 - x1 * y2;
      const dist = Math.abs(A * points[i].x + B * points[i].y + C) / Math.hypot(A, B);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }

    if (maxDist > tolerance) {
      markers[index] = true;
      stack.push([first, index]);
      stack.push([index, last]);
    }
  }

  return points.filter((_, i) => markers[i]);
}

/** 폴리라인 포인트를 SVG path로 변환 (단순화 포함) */
export function polylinePath(points: { x: number; y: number }[], simplify = true): string {
  if (points.length === 0) return '';
  const src = simplify && points.length > 10 ? simplifyPoints(points, 1.2) : points;
  return src.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

/** 브러시 스트로크 path 단순화 (필수 포인트만 남김) */
export function brushPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  // 2px 간격으로 다운샘플링 후 단순화
  const downsampled: { x: number; y: number }[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const last = downsampled[downsampled.length - 1];
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= 2) {
      downsampled.push(points[i]);
    }
  }
  downsampled.push(points[points.length - 1]);

  if (downsampled.length < 3) {
    return `M ${downsampled[0].x.toFixed(1)} ${downsampled[0].y.toFixed(1)} L ${downsampled[downsampled.length - 1].x.toFixed(1)} ${downsampled[downsampled.length - 1].y.toFixed(1)}`;
  }

  // 단순화된 포인트로 부드러운 스플라인
  const simple = simplifyPoints(downsampled, 1.0);
  if (simple.length < 3) {
    return `M ${simple[0].x.toFixed(1)} ${simple[0].y.toFixed(1)} L ${simple[simple.length - 1].x.toFixed(1)} ${simple[simple.length - 1].y.toFixed(1)}`;
  }

  let d = `M ${simple[0].x.toFixed(1)} ${simple[0].y.toFixed(1)}`;
  for (let i = 1; i < simple.length - 1; i++) {
    const xc = (simple[i].x + simple[i + 1].x) / 2;
    const yc = (simple[i].y + simple[i + 1].y) / 2;
    d += ` Q ${simple[i].x.toFixed(1)} ${simple[i].y.toFixed(1)}, ${xc.toFixed(1)} ${yc.toFixed(1)}`;
  }
  const last = simple[simple.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
}

/** 이미지 src가 data URL(base64)인지 감지 */
function isDataURL(src: string): boolean {
  return src.startsWith('data:');
}

/** data URL에서 MIME 타입 추출 */
function getDataURLMime(src: string): string | null {
  const m = src.match(/^data:([^;]+);/);
  return m ? m[1] : null;
}

/** 이미지 src에서 확장자 추출 */
function getImageExtension(src: string): string {
  if (isDataURL(src)) {
    const mime = getDataURLMime(src);
    if (mime) {
      const ext = mime.split('/')[1];
      if (ext) return ext.replace('jpeg', 'jpg');
    }
    return 'png';
  }
  const url = src.split('?')[0];
  const ext = url.split('.').pop()?.toLowerCase();
  return ext || 'png';
}

/** XML 이스케이프 */
function encodeXML(str: string): string {
  return (str || '')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&apos;');
}

/** 색상 16진수 정규화 (소문자 6자리) */
function normalizeColor(c: string): string {
  if (!c) return '#000000';
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    if (hex.length === 3) return '#' + [...hex].map(h => h + h).join('').toLowerCase();
    if (hex.length === 6) return '#' + hex.toLowerCase();
    if (hex.length === 8) return '#' + hex.slice(0, 6).toLowerCase();
  }
  return c.toLowerCase();
}

/** 중복 제거를 위한 defs 키 생성 */
function defsKey(type: string, params: Record<string, string | number>): string {
  return type + ':' + Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('|');
}

export interface SVGExportOptions {
  /** 이미지 처리 모드: 'embed'=data URL 임베딩, 'link'=원본 URL 유지, 'skip'=이미지 제외 */
  imageMode?: 'embed' | 'link' | 'skip';
  /** 좌표 소수점 자릿수 (기본 1) */
  precision?: number;
  /** 패스 단순화 허용 오차 (px, 기본 1.2) */
  simplifyTolerance?: number;
  /** 브러시 스트로크 다운샘플 간격 (px, 기본 2) */
  brushSampleDistance?: number;
  /** 투명 배경 */
  transparentBackground?: boolean;
  /** 메타데이터 포함 여부 */
  includeMetadata?: boolean;
}

const DEFAULT_OPTIONS: Required<SVGExportOptions> = {
  imageMode: 'link',
  precision: 1,
  simplifyTolerance: 1.2,
  brushSampleDistance: 2,
  transparentBackground: false,
  includeMetadata: false,
};

/** 타입 가드: ShapeElement인지 확인 */
function isShapeElement(el: CanvasElement): el is ShapeElement {
  return el.type === 'shape';
}

/** 메인 SVG 생성 함수 */
export function generateSVGString(
  layers: Layer[],
  elements: CanvasElement[],
  config: CanvasConfig,
  options: SVGExportOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { width, height, backgroundColor } = config;
  const precision = Math.max(0, Math.min(3, opts.precision));
  const fmt = (n: number) => precision === 0 ? Math.round(n).toString() : n.toFixed(precision);

  // --- 1. defs 수집 (중복 제거) ---
  const defsMap = new Map<string, string>();

  // 사용되는 shadow/gradient만 수집
  const usedShadows = new Set<string>();
  const usedGradients = new Set<string>();

  elements.forEach((el) => {
    if (isShapeElement(el) && el.shadow?.enabled) usedShadows.add(el.id);
    if (isShapeElement(el) && el.gradient?.enabled) usedGradients.add(el.id);
  });

  // Shadows
  usedShadows.forEach((id) => {
    const el = elements.find(e => e.id === id);
    if (!el?.shadow) return;
    const key = defsKey('shadow', {
      dx: el.shadow.offsetX,
      dy: el.shadow.offsetY,
      blur: el.shadow.blur / 2,
      color: normalizeColor(el.shadow.color),
    });
    if (!defsMap.has(key)) {
      defsMap.set(key, `
  <filter id="${key}" x="-50%" y="-50%" width="200%" height="200%">
    <feDropShadow dx="${fmt(el.shadow.offsetX)}" dy="${fmt(el.shadow.offsetY)}" stdDeviation="${fmt(el.shadow.blur / 2)}" flood-color="${normalizeColor(el.shadow.color)}" />
  </filter>`);
    }
  });

  // Gradients
  usedGradients.forEach((id) => {
    const el = elements.find(e => e.id === id);
    if (!isShapeElement(el) || !el.gradient) return;
    const g = el.gradient;
    const key = defsKey('grad', {
      type: g.type,
      angle: g.angle,
      start: normalizeColor(g.startColor),
      end: normalizeColor(g.endColor),
    });
    if (!defsMap.has(key)) {
      if (g.type === 'linear') {
        const rad = (g.angle * Math.PI) / 180;
        const x1 = Math.round(50 - Math.cos(rad) * 50);
        const y1 = Math.round(50 - Math.sin(rad) * 50);
        const x2 = Math.round(50 + Math.cos(rad) * 50);
        const y2 = Math.round(50 + Math.sin(rad) * 50);
        defsMap.set(key, `
  <linearGradient id="${key}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">
    <stop offset="0%" stop-color="${normalizeColor(g.startColor)}" />
    <stop offset="100%" stop-color="${normalizeColor(g.endColor)}" />
  </linearGradient>`);
      } else {
        defsMap.set(key, `
  <radialGradient id="${key}" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="${normalizeColor(g.startColor)}" />
    <stop offset="100%" stop-color="${normalizeColor(g.endColor)}" />
  </radialGradient>`);
      }
    }
  });

  // 각 요소의 defs 참조용 ID 매핑 저장
  const shadowRefMap = new Map<string, string>();
  const gradientRefMap = new Map<string, string>();

  elements.forEach((el) => {
    if (isShapeElement(el) && el.shadow?.enabled) {
      const key = defsKey('shadow', {
        dx: el.shadow.offsetX,
        dy: el.shadow.offsetY,
        blur: el.shadow.blur / 2,
        color: normalizeColor(el.shadow.color),
      });
      shadowRefMap.set(el.id, key);
    }
    if (isShapeElement(el) && el.gradient?.enabled) {
      const g = el.gradient;
      const key = defsKey('grad', {
        type: g.type,
        angle: g.angle,
        start: normalizeColor(g.startColor),
        end: normalizeColor(g.endColor),
      });
      gradientRefMap.set(el.id, key);
    }
  });

  const defs = Array.from(defsMap.values()).join('');

  // --- 2. 콘텐츠 생성 ---
  const parts: string[] = [];

  // Background
  if (!opts.transparentBackground && backgroundColor && backgroundColor !== 'transparent') {
    parts.push(`<rect width="${fmt(width)}" height="${fmt(height)}" fill="${normalizeColor(backgroundColor)}" />`);
  }

  // Iterate layers
  layers.forEach((layer) => {
    if (!layer.visible) return;

    const layerElements = elements.filter((el) => el.layerId === layer.id && el.visible !== false);
    if (layerElements.length === 0) return;

    const layerOpacity = layer.opacity !== 1 ? ` opacity="${fmt(layer.opacity)}"` : '';
    parts.push(`<g id="layer-${layer.id}" data-name="${encodeXML(layer.name)}"${layerOpacity}>`);

    layerElements.forEach((el) => {
      const rot = el.rotation || 0;
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const sx = el.flipH ? -1 : 1;
      const sy = el.flipV ? -1 : 1;
      const flipAttr = (el.flipH || el.flipV) ? `translate(${fmt(cx)} ${fmt(cy)}) scale(${sx} ${sy}) translate(${fmt(-cx)} ${fmt(-cy)}) ` : '';
      const filterAttr = el.shadow?.enabled ? ` filter="url(#${shadowRefMap.get(el.id)})"` : '';
      const opacityAttr = el.opacity !== 1 ? ` opacity="${fmt(el.opacity)}"` : '';

      const elementTransform = `${flipAttr}translate(${fmt(el.x)}, ${fmt(el.y)})${rot !== 0 ? ` rotate(${fmt(rot)})` : ''}`;

      switch (el.type) {
        case 'shape': {
          const isLine =
            el.shapeType === 'line' ||
            el.shapeType.startsWith('line-arrow') ||
            el.shapeType === 'polyline' ||
            el.shapeType === 'arc';

          let pathD = '';
          if (el.shapeType === 'polyline' && el.points && el.points.length >= 2) {
            pathD = polylinePath(el.points, true);
          } else if (el.shapeType === 'arc' && el.points && el.points.length >= 2 && el.arcRadius != null) {
            pathD = getArcPath(el.points[0], el.points[1], el.arcRadius, !!el.arcLarge, !!el.arcSweep);
          } else {
            pathD = getShapePath(el.shapeType, el.width, el.height, el.cornerRadius);
          }

          let fillAttr = isLine ? 'none' : normalizeColor(el.fill);
          if (!isLine && el.gradient?.enabled) {
            fillAttr = `url(#${gradientRefMap.get(el.id)})`;
          }
          let dashAttr = '';
          if (el.strokeDash === 'dashed') dashAttr = ' stroke-dasharray="8 6"';
          else if (el.strokeDash === 'dotted') dashAttr = ' stroke-dasharray="3 4"';

          const lineCaps = isLine ? ' stroke-linecap="round" stroke-linejoin="round"' : '';
          const strokeWidth = fmt(el.strokeWidth);
          const strokeColor = normalizeColor(el.stroke);

          parts.push(`<g transform="${elementTransform}">`);
          parts.push(`<path d="${pathD}" fill="${fillAttr}" stroke="${strokeColor}" stroke-width="${strokeWidth}"${lineCaps}${dashAttr}${opacityAttr}${filterAttr} />`);
          parts.push('</g>');
          break;
        }

        case 'brush': {
          if (!el.points || el.points.length < 2) return;
          const d = brushPath(el.points);
          const strokeColor = normalizeColor(el.color);
          const strokeWidth = fmt(el.strokeWidth);
          const opacity = el.isHighlighter ? fmt(el.opacity * 0.4) : fmt(el.opacity);

          parts.push(`<g transform="${flipAttr}">`);
          parts.push(`<path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"${filterAttr} />`);
          parts.push('</g>');
          break;
        }

        case 'text': {
          let textAnchor = 'start';
          let textX = fmt(el.x);
          if (el.align === 'center') {
            textAnchor = 'middle';
            textX = fmt(el.x + el.width / 2);
          } else if (el.align === 'right') {
            textAnchor = 'end';
            textX = fmt(el.x + el.width);
          }

          const fontStyle = el.italic ? 'italic' : 'normal';
          const fontWeight = el.bold ? 'bold' : 'normal';
          const textDeco = el.underline ? 'underline' : 'none';
          const fontFamily = encodeXML(el.fontFamily);
          const fontSize = fmt(el.fontSize);
          const color = normalizeColor(el.color);
          const transform = `${flipAttr}${rot !== 0 ? ` rotate(${fmt(rot)} ${fmt(cx)} ${fmt(cy)})` : ''}`;

          parts.push(`<text transform="${transform}" x="${textX}" y="${fmt(el.y + el.fontSize)}" font-family="${fontFamily}" font-size="${fontSize}" font-style="${fontStyle}" font-weight="${fontWeight}" text-decoration="${textDeco}" fill="${color}" text-anchor="${textAnchor}"${opacityAttr}${filterAttr}>`);
          const lines = el.text.split('\n');
          lines.forEach((line, i) => {
            const dy = i === 0 ? 0 : el.fontSize * 1.3;
            const safe = encodeXML(line.length === 0 ? '\u00A0' : line);
            parts.push(`<tspan x="${textX}" dy="${fmt(dy)}">${safe}</tspan>`);
          });
          parts.push('</text>');
          break;
        }

        case 'image': {
          if (opts.imageMode === 'skip') return;

          const imgEl = el as ImageElement;
          const href = imgEl.src;

          // data URL이면 임베딩 여부 결정
          let finalHref = href;
          if (isDataURL(href)) {
            if (opts.imageMode === 'link') {
              // 외부 링크 모드면 data URL을 그대로 두되 경고용 주석 추가
              finalHref = href;
            }
            // embed 모드면 그대로 사용 (base64 포함)
          }

          const f = imgEl.filters;
          const hasFilters = f && (
            f.brightness !== 100 || f.contrast !== 100 || f.saturation !== 100 ||
            f.grayscale > 0 || f.invert > 0 || f.blur > 0
          );
          const filterStyle = hasFilters
            ? `filter="brightness(${fmt(f.brightness / 100)}) contrast(${fmt(f.contrast / 100)}) saturate(${fmt(f.saturation / 100)}) blur(${fmt(f.blur)}px) grayscale(${fmt(f.grayscale / 100)}) invert(${fmt(f.invert / 100)})"`
            : '';

          const cornerRadius = imgEl.cornerRadius ? fmt(imgEl.cornerRadius) : '0';
          const borderWidth = imgEl.borderWidth ? fmt(imgEl.borderWidth) : '0';
          const borderColor = imgEl.borderColor ? normalizeColor(imgEl.borderColor) : 'none';

          const clipPathId = (cornerRadius !== '0' || borderWidth !== '0') ? `clip-${imgEl.id}` : '';
          if (clipPathId) {
            // clipPath는 defs에 추가 (단순화 위해 인라인으로 처리)
          }

          parts.push(`<image href="${encodeXML(finalHref)}" x="${fmt(el.x)}" y="${fmt(el.y)}" width="${fmt(el.width)}" height="${fmt(el.height)}" preserveAspectRatio="none"${filterStyle ? ` style="${filterStyle}"` : ''} opacity="${fmt(el.opacity)}" transform="${flipAttr}${rot !== 0 ? ` rotate(${fmt(rot)} ${fmt(cx)} ${fmt(cy)})` : ''}"${filterAttr} />`);
          break;
        }
      }
    });

    parts.push('</g>');
  });

  // --- 3. 최종 SVG 조립 ---
  const meta = opts.includeMetadata
    ? `<!-- Generated by imgman (${new Date().toISOString()}) -->\n`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
${meta}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}" width="${fmt(width)}" height="${fmt(height)}">
  <defs>
${defs}
  </defs>
${parts.join('\n')}
</svg>`;
}

/** SVG 파일 다운로드 */
export function downloadSVGFile(svgString: string, filename = 'drawing.svg'): void {
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** SVG 문자열 크기 분석 (디버깅용) */
export function analyzeSVGSize(svgString: string): { total: number; byType: Record<string, number> } {
  const byType: Record<string, number> = {};
  // 간단한 분석: 태그별 길이 합산
  const tagRegex = /<(\w+)([^>]*)>/g;
  let match;
  while ((match = tagRegex.exec(svgString)) !== null) {
    const tag = match[1];
    const len = match[0].length;
    byType[tag] = (byType[tag] || 0) + len;
  }
  return { total: svgString.length, byType };
}