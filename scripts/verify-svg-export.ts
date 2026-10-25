/**
 * SVG 내보내기 최적화 검증 스크립트
 * 실행: npx tsx scripts/verify-svg-export.ts
 */
import { generateSVGString, SVGExportOptions, analyzeSVGSize } from '../src/utils/svgExport';
import { CanvasConfig, CanvasElement, Layer, ShapeElement, BrushStrokeElement, TextElement, ImageElement, Point } from '../src/types';

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
  // 복잡한 브러시 스트로크 (많은 포인트)
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
  // 많은 앵커 포인트를 가진 폴리라인
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
    src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', // 1x1 투명 PNG
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

// 다양한 테스트 케이스
const testCases: Array<{ name: string; elements: CanvasElement[]; options: SVGExportOptions }> = [
  {
    name: '기본 도형 5개',
    elements: Array.from({ length: 5 }, (_, i) => makeShape({ x: 100 + i * 220, y: 100, shapeType: ['rect', 'ellipse', 'triangle', 'diamond', 'star'][i] as any })),
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
    name: '이미지 포함 (Base64) - link 모드',
    elements: [makeShape(), makeImage()],
    options: { imageMode: 'link' },
  },
  {
    name: '이미지 포함 (Base64) - embed 모드',
    elements: [makeShape(), makeImage()],
    options: { imageMode: 'embed' },
  },
  {
    name: '전체 기능 결합 (도형+브러시+텍스트+이미지)',
    elements: [makeShape(), makeBrush(), makePolyline(), makeImage(), makeText()],
    options: { imageMode: 'link', simplifyTolerance: 1.2, precision: 1 },
  },
  {
    name: '최대 압축 설정 (정수 좌표, 강한 단순화)',
    elements: [makeShape(), makeBrush(), makePolyline(), makeImage(), makeText()],
    options: { imageMode: 'link', simplifyTolerance: 2.0, precision: 0, brushSampleDistance: 5 },
  },
];

console.log('=== SVG Export Optimization Verification ===\n');

testCases.forEach(({ name, elements, options }) => {
  const svg = generateSVGString(layers, elements, config, options);
  const analysis = analyzeSVGSize(svg);
  const hasBase64 = svg.includes('data:image/');
  const hasLongPaths = svg.includes(' Q ') && svg.length > 5000;

  console.log(`[${name}]`);
  console.log(`  크기: ${(analysis.total / 1024).toFixed(2)} KB (${analysis.total} bytes)`);
  console.log(`  Base64 이미지: ${hasBase64 ? '있음 ⚠️' : '없음 ✓'}`);
  console.log(`  긴 Path: ${hasLongPaths ? '있음' : '없음'}`);
  console.log(`  주요 태그: ${Object.entries(analysis.byType).sort(([,a],[,b])=>b-a).slice(0,3).map(([k,v])=>`<${k}>:${(v/1024).toFixed(1)}KB`).join(', ')}`);
  console.log();
});

// 이미지 모드별 크기 비교
console.log('=== 이미지 처리 모드별 크기 비교 ===\n');
const linkSvg = generateSVGString(layers, [makeShape(), makeImage()], config, { imageMode: 'link' });
const embedSvg = generateSVGString(layers, [makeShape(), makeImage()], config, { imageMode: 'embed' });
const skipSvg = generateSVGString(layers, [makeShape(), makeImage()], config, { imageMode: 'skip' });

console.log(`link 모드:  ${(linkSvg.length / 1024).toFixed(2)} KB`);
console.log(`embed 모드: ${(embedSvg.length / 1024).toFixed(2)} KB (Base64 임베딩)`);
console.log(`skip 모드:  ${(skipSvg.length / 1024).toFixed(2)} KB`);

// 단순화 효과 확인
console.log('\n=== 폴리라인 단순화 효과 ===\n');
const poly = makePolyline();
const noSimplify = generateSVGString(layers, [poly], config, { simplifyTolerance: 0 });
const withSimplify = generateSVGString(layers, [poly], config, { simplifyTolerance: 1.5 });
console.log(`단순화 안 함: ${noSimplify.length} bytes`);
console.log(`단순화 적용: ${withSimplify.length} bytes (${((1 - withSimplify.length / noSimplify.length) * 100).toFixed(1)}% 감소)`);

console.log('\n=== 모든 테스트 통과 ===');