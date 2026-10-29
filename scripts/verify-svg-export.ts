/**
 * SVG보내기 최적화 검증 스크립트
 * 실행: npm run verify:svg
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { PNG } from 'pngjs';
import { generateSVGString, SVGExportOptions, analyzeSVGSize } from '../src/utils/svgExport';
import {
  getArrowHeadRotateDeg,
  getLineAngleDeg,
  getShortenedLineEndpoints,
  resolveArrowLinePoints,
} from '../src/utils/arrowUtils';
import {
  traceImageDataToFragment,
  createImagetracerRasterTracer,
  resolveVectorizeOptions,
  countPathsInMarkup,
  type RasterTracer,
} from '../src/utils/rasterVectorizer';
import { rgbaToImageData } from '../src/utils/imagePixels';
import { getExportVisibleImageElements } from '../src/utils/svgExportImages';
import {
  buildVectorizedImageMarkup,
  hasLegacyVectorizedTransformOrder,
  sanitizeSvgXmlId,
} from '../src/utils/vectorizedImageMarkup';
import { serializeSafeSvgColor } from '../src/utils/safeSvgColor';
import {
  CanvasConfig,
  CanvasElement,
  Layer,
  ShapeElement,
  BrushStrokeElement,
  TextElement,
  ImageElement,
  Point,
} from '../src/types';

const require = createRequire(import.meta.url);

function loadImagetracerSync(): RasterTracer {
  const instance = require('imagetracerjs') as {
    imagedataToSVG: (imgd: ImageData, options?: Record<string, unknown>) => string;
  };
  return createImagetracerRasterTracer(instance);
}

function assertPureVectorSvg(svg: string): void {
  if (/<image\b/i.test(svg)) throw new Error('assertPureVectorSvg: <image> present');
  if (/data:image/i.test(svg)) throw new Error('assertPureVectorSvg: data:image present');
  if (!/<path\b/i.test(svg)) throw new Error('assertPureVectorSvg: no <path>');
}

function loadFixturePng(): { width: number; height: number; rgba: Uint8Array } {
  const fixturePath = path.join(__dirname, '../tests/fixtures/im-261026-logo.png');
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Missing fixture: ${fixturePath} (run node scripts/extract-fixture-png.cjs)`);
  }
  const png = PNG.sync.read(fs.readFileSync(fixturePath));
  return { width: png.width, height: png.height, rgba: new Uint8Array(png.data) };
}

function hasFillNear(svg: string, r: number, g: number, b: number): boolean {
  const patterns = [
    `fill="rgb(${r},${g},${b})"`,
    `fill="rgb(${r}, ${g}, ${b})"`,
    `fill="#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}"`,
  ];
  const lower = svg.toLowerCase();
  return patterns.some((p) => lower.includes(p.toLowerCase()));
}

// 테스트용 캔버스 설정
const config: CanvasConfig = {
  width: 1920,
  height: 1080,
  backgroundColor: '#FFFFFF',
  showGrid: false,
  showRulers: false,
  snapToGrid: false,
  gridSize: 20,
};

const layers: Layer[] = [
  { id: 'layer-1', name: '배경', visible: true, locked: false, opacity: 1 },
  { id: 'layer-2', name: '도형', visible: true, locked: false, opacity: 1 },
];

function makeShape(overrides: Partial<ShapeElement> = {}): ShapeElement {
  return {
    id: 'shape-' + Math.random().toString(36).slice(2, 8),
    layerId: 'layer-2',
    name: '사각형',
    type: 'shape',
    x: 100,
    y: 100,
    width: 200,
    height: 150,
    rotation: 0,
    opacity: 1,
    visible: true,
    shapeType: 'rect',
    fill: '#FF6B6B',
    stroke: '#333333',
    strokeWidth: 2,
    strokeDash: 'solid',
    cornerRadius: 8,
    ...overrides,
  };
}

function makeBrush(overrides: Partial<BrushStrokeElement> = {}): BrushStrokeElement {
  const points: Point[] = [];
  for (let i = 0; i < 200; i++) {
    const t = i * 0.1;
    points.push({
      x: 300 + i * 2 + Math.sin(t) * 20,
      y: 200 + Math.cos(t) * 15,
    });
  }
  return {
    id: 'brush-' + Math.random().toString(36).slice(2, 8),
    layerId: 'layer-2',
    name: '자유 드로잉',
    type: 'brush',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    points,
    color: '#4ECDC4',
    strokeWidth: 3,
    ...overrides,
  };
}

function makePolyline(overrides: Partial<ShapeElement> = {}): ShapeElement {
  const points: Point[] = [];
  for (let i = 0; i < 50; i++) {
    points.push({ x: i * 10, y: Math.sin(i * 0.5) * 30 + 50 });
  }
  return {
    ...makeShape(),
    id: 'polyline-' + Math.random().toString(36).slice(2, 8),
    shapeType: 'polyline',
    points,
    strokeWidth: 2,
    fill: 'none',
    ...overrides,
  };
}

function makeImage(overrides: Partial<ImageElement> = {}): ImageElement {
  return {
    id: 'image-' + Math.random().toString(36).slice(2, 8),
    layerId: 'layer-2',
    name: '테스트 이미지',
    type: 'image',
    x: 600,
    y: 100,
    width: 300,
    height: 200,
    rotation: 0,
    opacity: 1,
    visible: true,
    src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    naturalWidth: 300,
    naturalHeight: 200,
    filters: { brightness: 100, contrast: 100, saturation: 100, blur: 0, grayscale: 0, invert: 0 },
    ...overrides,
  };
}

function makeText(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: 'text-' + Math.random().toString(36).slice(2, 8),
    layerId: 'layer-2',
    name: '텍스트',
    type: 'text',
    x: 100,
    y: 400,
    width: 300,
    height: 50,
    rotation: 0,
    opacity: 1,
    visible: true,
    text: 'Hello SVG Export!',
    fontFamily: 'system-ui',
    fontSize: 24,
    color: '#333333',
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
    ...overrides,
  };
}

const testCases: Array<{ name: string; elements: CanvasElement[]; options: SVGExportOptions }> = [
  {
    name: '기본 도형 5개',
    elements: Array.from({ length: 5 }, (_, i) =>
      makeShape({ x: 100 + i * 220, y: 100, shapeType: ['rect', 'ellipse', 'triangle', 'diamond', 'star'][i] as ShapeElement['shapeType'] })
    ),
    options: {},
  },
  {
    name: '복잡한 브러시 스트로크 (200포인트)',
    elements: [makeBrush()],
    options: {},
  },
  {
    name: '폴리라인 (50포인트) 단순화',
    elements: [makePolyline()],
    options: {},
  },
  {
    name: '이미지 포함 - preserve',
    elements: [makeShape(), makeImage()],
    options: { rasterHandling: 'preserve' },
  },
  {
    name: '전체 기능 결합 (도형+브러시+텍스트+이미지)',
    elements: [makeShape(), makeBrush(), makePolyline(), makeImage(), makeText()],
    options: { rasterHandling: 'preserve', simplifyTolerance: 1.2, precision: 1 },
  },
];

console.log('=== SVG Export Optimization Verification ===\n');

let failed = 0;

testCases.forEach(({ name, elements, options }) => {
  const svg = generateSVGString(layers, elements, config, options);
  const analysis = analyzeSVGSize(svg);
  const hasBase64 = svg.includes('data:image/');

  console.log(`[${name}]`);
  console.log(`  크기: ${(analysis.total / 1024).toFixed(2)} KB (${analysis.total} bytes)`);
  console.log(`  Base64 이미지: ${hasBase64 ? '있음 (preserve)' : '없음'}`);
  console.log();
});

console.log('=== Fixture logo vector trace (imagetracerjs) ===\n');
try {
  const { width, height, rgba } = loadFixturePng();
  const opts = resolveVectorizeOptions({ preset: 'logo' });
  const tracer = loadImagetracerSync();
  const imageData = rgbaToImageData(width, height, rgba);
  const { fragment, pathCount } = traceImageDataToFragment(imageData, opts, tracer);
  const miniSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${fragment}</svg>`;
  assertPureVectorSvg(miniSvg);
  if (pathCount < 2) throw new Error(`Expected multiple paths, got ${pathCount}`);
  const hasWhite =
    hasFillNear(miniSvg, 255, 255, 255) ||
    miniSvg.includes('242,247,254') ||
    miniSvg.includes('255,255,255');
  const hasBlue =
    hasFillNear(miniSvg, 0, 51, 153) ||
    miniSvg.includes('0,95,253') ||
    miniSvg.includes('0,51,153');
  if (!hasWhite) throw new Error('Fixture trace missing light/white interior fill');
  if (!hasBlue) throw new Error('Fixture trace missing blue logo fill');
  console.log(`  Fixture ${width}x${height}: paths=${pathCount}, pure vector OK`);
  console.log(`  Colors detected: white=${hasWhite}, blue=${hasBlue}`);
} catch (e) {
  console.error('  FIXTURE TRACE FAILED:', e);
  failed += 1;
}

console.log('\n=== generateSVGString vectorize guard ===\n');
try {
  generateSVGString(layers, [makeImage()], config, { rasterHandling: 'vectorize' });
  console.error('  Expected throw for sync vectorize');
  failed += 1;
} catch {
  console.log('  sync generateSVGString rejects vectorize mode OK');
}

console.log('\n=== skip mode ===\n');
const skipSvg = generateSVGString(layers, [makeShape(), makeImage()], config, { rasterHandling: 'skip' });
if (skipSvg.includes('<image')) {
  console.error('  skip mode still has image');
  failed += 1;
} else {
  console.log('  skip mode: no <image> OK');
}

console.log('\n=== Vectorized image markup (transform order) ===\n');
try {
  const fmt = (n: number) => n.toFixed(1);
  const markup = buildVectorizedImageMarkup({
    elementId: 'img/weird<id>',
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    rotation: 45,
    flipH: true,
    flipV: false,
    opacity: 0.5,
    cornerRadius: 8,
    borderWidth: 2,
    borderColor: '#003399',
    traceWidth: 200,
    traceHeight: 100,
    fragment: '<path d="M0 0 L1 1" fill="rgb(0,95,253)" />',
    fmt,
  });

  if (hasLegacyVectorizedTransformOrder(markup, 10, 20)) {
    throw new Error('Markup uses legacy translate+rotate on same transform attribute');
  }
  if (!markup.includes('rotate(45.0 60.0 45.0)')) {
    throw new Error('Missing outer rotate around element center');
  }
  if (!markup.includes('translate(10.0 20.0)')) {
    throw new Error('Missing inner translate(x,y)');
  }
  if (!markup.includes('scale(0.5 0.5)')) {
    throw new Error('Missing inner scale to element size');
  }
  if (!markup.includes('opacity="0.5"')) {
    throw new Error('Missing opacity');
  }
  const safeId = sanitizeSvgXmlId('img/weird<id>');
  if (!markup.includes(`clip-path="url(#clip-img-${safeId})"`)) {
    throw new Error('Missing sanitized clip-path id');
  }
  if (!markup.includes('stroke="#003399"')) {
    throw new Error('Missing border stroke inside transformed group');
  }
  if (!markup.match(/<g transform="[^"]*scale\(-1 1\)/)) {
    throw new Error('Missing flipH on outer group');
  }
  const outerMatch = markup.match(/^<g transform="([^"]*)">/);
  if (!outerMatch || outerMatch[1].includes('translate(10')) {
    throw new Error('Outer transform must not include translate(x,y)');
  }

  const hiddenLayers: Layer[] = [
    { id: 'hidden', name: 'H', visible: false, locked: false, opacity: 1 },
    { id: 'layer-2', name: '도형', visible: true, locked: false, opacity: 1 },
  ];
  const hiddenImg = makeImage({ layerId: 'hidden' });
  const visible = getExportVisibleImageElements(hiddenLayers, [hiddenImg, makeImage()]);
  if (visible.length !== 1 || visible[0].layerId !== 'layer-2') {
    throw new Error('getExportVisibleImageElements should ignore hidden layer images');
  }

  const idA = sanitizeSvgXmlId('foo/bar');
  const idB = sanitizeSvgXmlId('foo_bar');
  if (idA === idB) {
    throw new Error('sanitizeSvgXmlId collision: foo/bar and foo_bar must differ');
  }

  const maliciousColor = '#000" onmouseover="alert(1)" stroke="#000';
  const evilMarkup = buildVectorizedImageMarkup({
    elementId: 'x',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    opacity: 1,
    borderWidth: 1,
    borderColor: maliciousColor,
    traceWidth: 10,
    traceHeight: 10,
    fragment: '<path d="M0 0"/>',
    fmt: (n) => String(n),
  });
  if (evilMarkup.includes('onmouseover')) {
    throw new Error('Malicious borderColor payload escaped into markup');
  }
  if (evilMarkup.includes('<script')) {
    throw new Error('Script tag payload in markup');
  }
  if (!evilMarkup.includes('stroke="#000000"')) {
    throw new Error('Malicious borderColor must fall back to safe #000000 stroke');
  }

  const scriptPayload = 'red"/><script>alert(1)</script><rect stroke="';
  const safe = serializeSafeSvgColor(scriptPayload);
  if (safe !== '#000000' || /script|alert/i.test(safe)) {
    throw new Error('serializeSafeSvgColor must not preserve script payload');
  }

  if (serializeSafeSvgColor('rgb(10, 20, 30)') !== 'rgb(10,20,30)') {
    throw new Error('serializeSafeSvgColor must accept valid rgb()');
  }
  if (serializeSafeSvgColor('rgba(0, 128, 255, 0.5)') !== 'rgba(0,128,255,0.5)') {
    throw new Error('serializeSafeSvgColor must accept valid rgba()');
  }
  if (serializeSafeSvgColor('transparent') !== 'transparent') {
    throw new Error('serializeSafeSvgColor must preserve named transparent');
  }
  if (serializeSafeSvgColor('none') !== 'none') {
    throw new Error('serializeSafeSvgColor must preserve named none');
  }
  if (serializeSafeSvgColor('url(#evil)') !== '#000000') {
    throw new Error('serializeSafeSvgColor must reject url()');
  }
  if (serializeSafeSvgColor('rgb(1,2,3); alert(1)') !== '#000000') {
    throw new Error('serializeSafeSvgColor must reject semicolon breakout after rgb-like text');
  }

  console.log('  buildVectorizedImageMarkup + visible image filter + security OK');
} catch (e) {
  console.error('  MARKUP TEST FAILED:', e);
  failed += 1;
}

console.log('\n=== Path count helper ===\n');
const samplePaths = '<path d="M0 0"/><path d="M1 1"/>';
if (countPathsInMarkup(samplePaths) !== 2) {
  failed += 1;
  console.error('  countPathsInMarkup failed');
} else {
  console.log('  countPathsInMarkup OK');
}

console.log('\n=== Arrow head orientation (begin opposite end) ===\n');
try {
  const normDeg = (a: number) => ((a % 360) + 360) % 360;
  const isOppositeDeg = (a: number, b: number, eps = 1e-6) => {
    const d = Math.abs(normDeg(a) - normDeg(b));
    return Math.abs(Math.min(d, 360 - d) - 180) < eps;
  };
  const parseHeadTransforms = (svg: string) => {
    const re =
      /<path[^>]*\stransform="translate\(([^,]+),\s*([^)]+)\) rotate\(([^)]+)\)"/g;
    const heads: { x: number; y: number; rotate: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(svg))) {
      heads.push({ x: Number(m[1]), y: Number(m[2]), rotate: Number(m[3]) });
    }
    return heads;
  };

  const orientations: Array<{
    name: string;
    start: { x: number; y: number };
    end: { x: number; y: number };
  }> = [
    { name: 'horizontal', start: { x: 0, y: 2 }, end: { x: 100, y: 2 } },
    { name: 'diagonal', start: { x: 0, y: 0 }, end: { x: 80, y: 80 } },
    { name: 'reversed', start: { x: 100, y: 2 }, end: { x: 0, y: 2 } },
    { name: 'reversed-diagonal', start: { x: 80, y: 80 }, end: { x: 0, y: 0 } },
  ];

  for (const { name, start, end } of orientations) {
    const angle = getLineAngleDeg(start.x, start.y, end.x, end.y);
    const beginRotate = getArrowHeadRotateDeg(angle, 'begin');
    const endRotate = getArrowHeadRotateDeg(angle, 'end');
    if (endRotate !== angle) {
      throw new Error(`${name}: end rotate must equal line angle (${endRotate} vs ${angle})`);
    }
    if (beginRotate !== angle + 180) {
      throw new Error(`${name}: begin rotate must be angle+180 (${beginRotate} vs ${angle + 180})`);
    }
    if (!isOppositeDeg(beginRotate, endRotate)) {
      throw new Error(`${name}: begin ${beginRotate} is not opposite end ${endRotate}`);
    }

    const resolved = resolveArrowLinePoints(100, 4, [start, end]);
    if (resolved.start.x !== start.x || resolved.start.y !== start.y) {
      throw new Error(`${name}: resolveArrowLinePoints moved start`);
    }
    if (resolved.end.x !== end.x || resolved.end.y !== end.y) {
      throw new Error(`${name}: resolveArrowLinePoints moved end`);
    }

    const shortened = getShortenedLineEndpoints(
      start.x,
      start.y,
      end.x,
      end.y,
      2,
      'triangle',
      'medium',
      'triangle',
      'medium'
    );
    const el = makeShape({
      id: `arrow-${name}`,
      name: `arrow-${name}`,
      shapeType: 'line-arrow-both',
      fill: 'none',
      stroke: '#111111',
      strokeWidth: 2,
      width: 100,
      height: 80,
      x: 10,
      y: 20,
      beginArrow: { type: 'triangle', size: 'medium' },
      endArrow: { type: 'triangle', size: 'medium' },
      points: [start, end],
    });
    const svg = generateSVGString(layers, [el], config, { precision: 1 });
    const heads = parseHeadTransforms(svg);
    if (heads.length !== 2) {
      throw new Error(`${name}: expected 2 exported heads, got ${heads.length}\n${svg}`);
    }
    const beginHead = heads.find(
      (h) => Math.abs(h.x - start.x) < 0.05 && Math.abs(h.y - start.y) < 0.05
    );
    const endHead = heads.find(
      (h) => Math.abs(h.x - end.x) < 0.05 && Math.abs(h.y - end.y) < 0.05
    );
    if (!beginHead) throw new Error(`${name}: missing begin head at ${start.x},${start.y}`);
    if (!endHead) throw new Error(`${name}: missing end head at ${end.x},${end.y}`);
    if (Math.abs(beginHead.rotate - beginRotate) > 0.05) {
      throw new Error(`${name}: export begin rotate ${beginHead.rotate} != ${beginRotate}`);
    }
    if (Math.abs(endHead.rotate - endRotate) > 0.05) {
      throw new Error(`${name}: export end rotate ${endHead.rotate} != ${endRotate}`);
    }
    if (!isOppositeDeg(beginHead.rotate, endHead.rotate, 0.05)) {
      throw new Error(
        `${name}: exported heads not opposite (${beginHead.rotate} vs ${endHead.rotate})`
      );
    }
    const lineMatch = svg.match(
      /<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/
    );
    if (!lineMatch) throw new Error(`${name}: missing exported shaft <line>`);
    const shaft = {
      x1: Number(lineMatch[1]),
      y1: Number(lineMatch[2]),
      x2: Number(lineMatch[3]),
      y2: Number(lineMatch[4]),
    };
    if (Math.abs(shaft.x1 - shortened.startX) > 0.05 || Math.abs(shaft.y1 - shortened.startY) > 0.05) {
      throw new Error(`${name}: shaft start moved`);
    }
    if (Math.abs(shaft.x2 - shortened.endX) > 0.05 || Math.abs(shaft.y2 - shortened.endY) > 0.05) {
      throw new Error(`${name}: shaft end moved`);
    }
    console.log(
      `  ${name}: begin=${beginRotate} end=${endRotate} opposite, endpoints preserved OK`
    );
  }
} catch (e) {
  console.error('  ARROW ORIENTATION FAILED:', e);
  failed += 1;
}

if (failed > 0) {
  console.error(`\n=== ${failed} verification failure(s) ===`);
  process.exit(1);
}

console.log('\n=== 모든 테스트 통과 ===');
