/**
 * 격자(테이블) 배치 + 이미지 맞춤 검증 스크립트.
 *   npm run verify:grid
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_TABLE_GRID,
  clampTableGridSpec,
  computeTableGridCells,
  countTableGridCells,
} from '../src/utils/tableGrid';
import {
  computeImageFitRect,
  resolveImageAspect,
  clampAspectZoom,
  clampAspectFocus,
} from '../src/utils/imageFit';
import { validateProjectData } from '../src/utils/projectSchema';
import { generateSVGString } from '../src/utils/svgExport';
import type { CanvasConfig, ImageElement, Layer } from '../src/types';

const close = (actual: number, expected: number, label = '') =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label} ${actual} != ${expected}`);

/* ------------------------------------------------------------------ */
/* 1. 격자 설정 정규화                                                 */
/* ------------------------------------------------------------------ */
assert.deepEqual(clampTableGridSpec({ columns: 0, rows: -3, gap: -10, showGuides: true }), {
  columns: 1,
  rows: 1,
  gap: 0,
  showGuides: true,
});
assert.deepEqual(clampTableGridSpec({ columns: 999, rows: 999, gap: 9999, showGuides: false }), {
  columns: 50,
  rows: 6,
  gap: 200,
  showGuides: false,
});
// 칸 수 상한 (50 × 6 = 300 ≤ 400)
assert.ok(clampTableGridSpec({ columns: 999, rows: 999 }).columns * clampTableGridSpec({ columns: 999, rows: 999 }).rows <= 400);
assert.equal(countTableGridCells(null), 0);
assert.equal(countTableGridCells(DEFAULT_TABLE_GRID), 4);

/* ------------------------------------------------------------------ */
/* 2. 셀이 캔버스를 빈틈없이 채우는지                                  */
/* ------------------------------------------------------------------ */
const canvas = { width: 1280, height: 720 };
for (const spec of [
  { columns: 1, rows: 1, gap: 0, showGuides: true },
  { columns: 3, rows: 2, gap: 0, showGuides: true },
  { columns: 4, rows: 3, gap: 12, showGuides: true },
  { columns: 7, rows: 5, gap: 20, showGuides: true },
  { columns: 2, rows: 2, gap: 9999, showGuides: true }, // 과도한 여백 → 자동 축소
]) {
  const cells = computeTableGridCells(canvas.width, canvas.height, spec);
  assert.equal(cells.length, spec.columns * spec.rows, `cell count for ${JSON.stringify(spec)}`);

  // 행 우선 순서 (좌상단 → 우하단)
  cells.forEach((cell, index) => {
    assert.equal(cell.index, index);
    assert.equal(cell.row, Math.floor(index / spec.columns));
    assert.equal(cell.column, index % spec.columns);
  });

  // 각 셀의 좌우/상하 경계가 캔버스 경계와 정확히 맞닿는지
  const first = cells[0];
  const last = cells[cells.length - 1];
  close(first.x, 0, 'first cell x');
  close(first.y, 0, 'first cell y');
  close(last.x + last.width, canvas.width, 'last cell right');
  close(last.y + last.height, canvas.height, 'last cell bottom');

  // 같은 행/열의 셀은 크기가 같아야 한다
  const rowCells = cells.filter((c) => c.row === 0);
  rowCells.forEach((c) => close(c.height, rowCells[0].height, 'row cell height'));
  const colCells = cells.filter((c) => c.column === 0);
  colCells.forEach((c) => close(c.width, colCells[0].width, 'col cell width'));

  // 셀이 겹치지 않는지
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i];
      const b = cells[j];
      const overlap =
        a.x < b.x + b.width - 1e-6 &&
        b.x < a.x + a.width - 1e-6 &&
        a.y < b.y + b.height - 1e-6 &&
        b.y < a.y + a.height - 1e-6;
      assert.ok(!overlap, `cells ${i} and ${j} overlap`);
    }
  }
}

// 여백이 있으면 그만큼 칸 사이가 벌어져야 한다
const gapped = computeTableGridCells(1000, 500, { columns: 2, rows: 1, gap: 100, showGuides: true });
close(gapped[0].width, 450, 'gapped cell width');
close(gapped[1].x, 550, 'gapped second cell x');

/* ------------------------------------------------------------------ */
/* 3. 이미지 맞춤 (cover / contain)                                    */
/* ------------------------------------------------------------------ */
const box = { x: 0, y: 0, width: 200, height: 100 };
const natural = { width: 400, height: 200 }; // 2:1

// none → 박스 그대로
const none = computeImageFitRect(box, natural, resolveImageAspect({ aspectFit: 'none' }));
assert.deepEqual(none, box);

// cover → 비율 유지 + 빈틈 없음(한 축은 정확히 맞고 다른 축은 넘침)
const cover = computeImageFitRect(
  box,
  natural,
  resolveImageAspect({ aspectFit: 'cover' })
);
close(cover.width / cover.height, natural.width / natural.height, 'cover ratio');
assert.ok(cover.width >= box.width - 1e-6 && cover.height >= box.height - 1e-6, 'cover fills box');
close(cover.height, 100, 'cover height');
close(cover.width, 200, 'cover width');
close(cover.x, 0, 'cover centered x');
close(cover.y, 0, 'cover centered y');

// contain → 전체가 보이고 여백이 남음
const contain = computeImageFitRect(
  box,
  natural,
  resolveImageAspect({ aspectFit: 'contain' })
);
close(contain.width / contain.height, natural.width / natural.height, 'contain ratio');
assert.ok(contain.width <= box.width + 1e-6 && contain.height <= box.height + 1e-6, 'contain fits box');
close(contain.height, 100, 'contain height');
close(contain.width, 200, 'contain width');

// 세로로 긴 이미지 + cover → 좌우가 정확히 맞고 위아래로 잘린다
const tall = computeImageFitRect(
  box,
  { width: 100, height: 400 },
  resolveImageAspect({ aspectFit: 'cover' })
);
close(tall.width / tall.height, 0.25, 'tall cover ratio');
close(tall.height, 800, 'tall cover height');
close(tall.width, 200, 'tall cover width');
close(tall.x, 0, 'tall cover centered x');
close(tall.y, -350, 'tall cover centered y');

// 가로로 긴 이미지 + cover → 위아래가 정확히 맞고 좌우로 잘린다
const wide = computeImageFitRect(
  { x: 0, y: 0, width: 100, height: 100 },
  { width: 400, height: 100 },
  resolveImageAspect({ aspectFit: 'cover' })
);
close(wide.width, 400, 'wide cover width');
close(wide.height, 100, 'wide cover height');
close(wide.x, -150, 'wide cover centered x');

// 초점 이동 → 잘리는 위치가 바뀐다
const focusLeft = computeImageFitRect(
  { x: 0, y: 0, width: 100, height: 100 },
  { width: 400, height: 100 },
  resolveImageAspect({ aspectFit: 'cover', aspectFocusX: 0 })
);
close(focusLeft.x, 0, 'focus left x');
const focusRight = computeImageFitRect(
  { x: 0, y: 0, width: 100, height: 100 },
  { width: 400, height: 100 },
  resolveImageAspect({ aspectFit: 'cover', aspectFocusX: 1 })
);
close(focusRight.x, -300, 'focus right x');

// 확대 → 더 많이 잘린다
const zoomed = computeImageFitRect(
  box,
  { width: 100, height: 400 },
  resolveImageAspect({ aspectFit: 'cover', aspectZoom: 2 })
);
close(zoomed.height, 1600, 'zoomed height');
close(zoomed.width, 400, 'zoomed width');

assert.equal(clampAspectZoom(0.2), 1);
assert.equal(clampAspectZoom(99), 4);
assert.equal(clampAspectFocus(-1), 0);
assert.equal(clampAspectFocus(5), 1);
assert.equal(resolveImageAspect({}).fit, 'none');

/* ------------------------------------------------------------------ */
/* 4. 프로젝트 저장/불러오기에서 격자·맞춤 설정이 유지되는지            */
/* ------------------------------------------------------------------ */
const layer: Layer = { id: 'layer-1', name: '레이어1', visible: true, locked: false, opacity: 1 };
const config: CanvasConfig = {
  width: 1280,
  height: 720,
  backgroundColor: '#FFFFFF',
  showGrid: false,
  showRulers: true,
  snapToGrid: false,
  gridSize: 20,
  tableGrid: { columns: 3, rows: 2, gap: 10, showGuides: true },
};
const image: ImageElement = {
  id: 'image-1',
  layerId: 'layer-1',
  name: 'grid-image',
  type: 'image',
  src: 'data:image/png;base64,AAAA',
  naturalWidth: 400,
  naturalHeight: 200,
  x: 0,
  y: 0,
  width: 640,
  height: 350,
  rotation: 0,
  opacity: 1,
  filters: {
    brightness: 100,
    contrast: 100,
    saturation: 100,
    blur: 0,
    grayscale: 0,
    invert: 0,
  },
  aspectFit: 'cover',
  aspectZoom: 1.5,
  aspectFocusX: 0.25,
  aspectFocusY: 0.75,
};

const validated = validateProjectData({
  version: '1.0.0',
  config,
  layers: [layer],
  elements: [image],
});
assert.ok(validated.ok, 'project validates');
assert.deepEqual(
  validated.data!.config.tableGrid,
  { columns: 3, rows: 2, gap: 10, showGuides: true },
  'tableGrid survives round-trip'
);
const restoredImage = validated.data!.elements[0] as ImageElement;
assert.equal(restoredImage.aspectFit, 'cover');
assert.equal(restoredImage.aspectZoom, 1.5);
assert.equal(restoredImage.aspectFocusX, 0.25);
assert.equal(restoredImage.aspectFocusY, 0.75);

// 잘못된 맞춤 값은 거부된다
const invalid = validateProjectData({
  version: '1.0.0',
  config: { ...config, tableGrid: { columns: 0, rows: 2, gap: 0, showGuides: true } },
  layers: [layer],
  elements: [],
});
assert.equal(invalid.ok, false, 'invalid tableGrid is rejected');

/* ------------------------------------------------------------------ */
/* 5. SVG 내보내기가 화면과 동일하게 cover 맞춰지는지                    */
/* ------------------------------------------------------------------ */
const svg = generateSVGString([layer], [image], config);
assert.ok(svg.includes('clip-path="url(#clip-img-'), 'cover image is clipped');
assert.ok(svg.includes('<clipPath id="clip-img-'), 'cover image has a clip def');
// cover + zoom(1.5) + focus(0.25, 0.75):
// scale = max(640/400, 350/200) * 1.5 = 2.625 → 1050x525, x = -410*0.25, y = -175*0.75
assert.ok(
  svg.includes('x="-102.5"') &&
    svg.includes('y="-131.3"') &&
    svg.includes('width="1050.0"') &&
    svg.includes('height="525.0"'),
  `cover image rect matches canvas rendering:\n${svg.split('\n').filter((l) => l.includes('<image')).join('\n')}`
);

// 늘이기(none) 이미지는 기존처럼 박스를 그대로 사용한다
const legacyImage: ImageElement = { ...image, aspectFit: 'none' };
const legacySvg = generateSVGString([layer], [legacyImage], config);
assert.ok(legacySvg.includes('x="0" y="0" width="640.0" height="350.0"'), 'legacy image keeps stretch rect');
assert.ok(!legacySvg.includes('clip-path="url(#clip-img-'), 'legacy image has no extra clip');

/* ------------------------------------------------------------------ */
/* 6. 칸 확장(행 +n / 열 +n) 후에도 셀이 캔버스를 정확히 채우는지      */
/* ------------------------------------------------------------------ */
const baseSpec = { columns: 2, rows: 2, gap: 0, showGuides: true };
// 기본 확장값: 행 +1, 열 +0 → 2열 × 3행 = 6칸
const expanded = clampTableGridSpec({
  ...baseSpec,
  rows: baseSpec.rows + 1,
  columns: baseSpec.columns + 0,
});
assert.deepEqual(expanded, { columns: 2, rows: 3, gap: 0, showGuides: true });
const expandedCells = computeTableGridCells(canvas.width, canvas.height, expanded);
assert.equal(expandedCells.length, 6);
close(expandedCells[expandedCells.length - 1].x + expandedCells[expandedCells.length - 1].width, canvas.width);
close(expandedCells[expandedCells.length - 1].y + expandedCells[expandedCells.length - 1].height, canvas.height);
// 열 확장: 2열 × 2행 → 4열 × 2행 = 8칸
const wideExpanded = clampTableGridSpec({ ...baseSpec, columns: baseSpec.columns + 2, rows: baseSpec.rows + 0 });
assert.equal(wideExpanded.columns, 4);
assert.equal(wideExpanded.rows, 2);
assert.equal(computeTableGridCells(canvas.width, canvas.height, wideExpanded).length, 8);

console.log(
  'PASS: table grid cells fill the canvas, image fit keeps the aspect ratio (cover/contain), project files keep the new settings, SVG export matches the canvas, and row/column expansion works.'
);
