/**
 * Checks for the "last chosen style" memory (채우기 / 선 / 윤곽선) — 2026-11-02.
 *
 * Run: node scripts/run-node-esm.mjs scripts/verify-style-prefs.ts
 */
import type { ShapeElement } from '../src/types';
import {
  DEFAULT_LINE_STYLE,
  DEFAULT_SHAPE_STYLE,
  applyToolbarColorToShape,
  recordDrawnArrowHeads,
  recordLineStyleChange,
  recordShapeStyleChange,
  resolveNewShapeStroke,
} from '../src/utils/stylePrefs';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const rect: ShapeElement = {
  id: 'r1',
  type: 'shape',
  shapeType: 'rect',
  name: 'r',
  layerId: 'l',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  fill: '#3B82F6',
  stroke: '#000000',
  strokeWidth: 2,
  strokeDash: 'solid',
};
const line: ShapeElement = {
  ...rect,
  id: 'l1',
  shapeType: 'line-arrow',
  fill: 'none',
  stroke: '#EF4444',
  lineCap: 'round',
  beginArrow: { type: 'none', size: 'medium' },
  endArrow: { type: 'triangle', size: 'medium' },
};

console.log('채우기 (fill)');
{
  const m = recordShapeStyleChange(DEFAULT_SHAPE_STYLE, rect, { ...rect, fill: '#10B981' });
  check('color fill remembered', m.fill === '#10B981');
  const none = recordShapeStyleChange(m, rect, { ...rect, fill: 'none' });
  check('투명 채우기 (none) remembered', none.fill === 'none');
  const grad = recordShapeStyleChange(none, rect, {
    ...rect,
    gradient: { enabled: true, type: 'linear', startColor: '#111111', endColor: '#222222', angle: 90 },
  });
  check('gradient remembered', !!grad.gradient?.enabled && grad.gradient.endColor === '#222222');
}

console.log('윤곽선 (outline)');
{
  const m = recordShapeStyleChange(DEFAULT_SHAPE_STYLE, rect, { ...rect, stroke: 'none' });
  check('선 없음 remembered', m.stroke === 'none');
  const w = recordShapeStyleChange(m, rect, { ...rect, strokeWidth: 7, strokeDash: 'dashed' });
  check('width + dash remembered', w.strokeWidth === 7 && w.strokeDash === 'dashed');
  check('unchanged props untouched', w.stroke === 'none' && w.fill === DEFAULT_SHAPE_STYLE.fill);
}

console.log('moving / resizing does not rewrite memory');
{
  const mem = { ...DEFAULT_SHAPE_STYLE, fill: '#FF00FF' };
  const moved = recordShapeStyleChange(mem, rect, { ...rect, x: 50, y: 60, width: 99 });
  check('same object returned for geometry-only change', moved === mem);
  const lineMem = { ...DEFAULT_LINE_STYLE, stroke: '#00FF00' };
  const lineMoved = recordLineStyleChange(lineMem, line, { ...line, x: 5, rotation: 30 });
  check('line memory unchanged by move', lineMoved === lineMem);
}

console.log('선 (line)');
{
  const m = recordLineStyleChange(DEFAULT_LINE_STYLE, line, {
    ...line,
    stroke: '#3B82F6',
    strokeDash: 'dotted',
    lineCap: 'square',
    endArrow: { type: 'diamond', size: 'large' },
  });
  check('line color', m.stroke === '#3B82F6');
  check('line dash + cap', m.strokeDash === 'dotted' && m.lineCap === 'square');
  check('arrow head', m.endArrow.type === 'diamond' && m.endArrow.size === 'large');
  const plain: ShapeElement = { ...line, shapeType: 'line', beginArrow: undefined, endArrow: undefined };
  const p = recordLineStyleChange(m, plain, { ...plain, stroke: '#000000' });
  check('plain line does not erase arrow heads', p.endArrow.type === 'diamond');
  const drawn = recordDrawnArrowHeads(DEFAULT_LINE_STYLE, {
    ...line,
    shapeType: 'line-arrow-both',
    beginArrow: { type: 'triangle', size: 'medium' },
    endArrow: { type: 'triangle', size: 'medium' },
  });
  check('drawn arrow heads remembered', drawn.beginArrow.type === 'triangle');
}

console.log('toolbar color + new shape outline');
{
  const filled = applyToolbarColorToShape({ ...DEFAULT_SHAPE_STYLE, fill: '#111111' }, '#ABCDEF');
  check('filled memory: toolbar color -> fill', filled.fill === '#ABCDEF');
  const outline = applyToolbarColorToShape({ ...DEFAULT_SHAPE_STYLE, fill: 'none' }, '#ABCDEF');
  check('no-fill memory: toolbar color -> outline', outline.stroke === '#ABCDEF' && outline.fill === 'none');
  check(
    'no outline + fill -> none',
    resolveNewShapeStroke({ ...DEFAULT_SHAPE_STYLE, fill: '#123456', stroke: 'none' }, '#FF0000') === 'none'
  );
  check(
    'no outline + no fill -> fallback (never invisible)',
    resolveNewShapeStroke({ ...DEFAULT_SHAPE_STYLE, fill: 'none', stroke: 'none' }, '#FF0000') === '#FF0000'
  );
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall style-prefs checks passed');
