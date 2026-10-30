/**
 * Checks for the pen path / lasso / history-panel features (2026-10-30).
 *
 * Run: node scripts/run-node-esm.mjs scripts/verify-pen-lasso-history.ts
 */
import { CanvasConfig, CanvasElement, HistorySnapshot, Layer, PathNode, Point, ShapeElement, ShapeType } from '../src/types';
import {
  convertShapeToPath,
  cubicAt,
  finalizePathGeometry,
  getPathNodesD,
  moveHandle,
  nearestOnPath,
  parsePathDataToNodes,
  refitPathElement,
  samplePathNodes,
  segmentControls,
  splitSegment,
  toggleNodeSmooth,
} from '../src/utils/pathNodes';
import { canvasToLocal, localToCanvas } from '../src/utils/elementGeometry';
import {
  clippedPolygonBounds,
  isElementInsidePolygon,
  pointInPolygon,
  polygonArea,
  simplifyPolygon,
} from '../src/utils/lassoSelection';
import { describeHistoryStep } from '../src/utils/historyLabels';
import { commitHistory, createHistory, jumpToHistory } from '../src/hooks/useDocumentHistory';
import { validateProjectData } from '../src/utils/projectSchema';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const nearPt = (a: Point, b: Point, eps = 1e-6) => near(a.x, b.x, eps) && near(a.y, b.y, eps);

function shape(partial: Partial<ShapeElement>): ShapeElement {
  return {
    id: 's1',
    layerId: 'layer-1',
    name: '도형',
    type: 'shape',
    shapeType: 'rect',
    x: 100,
    y: 50,
    width: 200,
    height: 120,
    rotation: 0,
    opacity: 1,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 2,
    strokeDash: 'solid',
    ...partial,
  };
}

/** Canvas positions of the drawn outline, for before/after comparisons */
function canvasOutline(el: ShapeElement): Point[] {
  return samplePathNodes(el.pathNodes!, !!el.pathClosed, 8).map((p) => localToCanvas(el, p));
}

console.log('\n[1] local ↔ canvas transforms');
for (const variant of [
  {},
  { rotation: 37 },
  { rotation: 200, flipH: true },
  { rotation: -15, flipV: true, flipH: true },
]) {
  const el = shape(variant);
  const p = { x: 33, y: 71 };
  const back = canvasToLocal(el, localToCanvas(el, p));
  check(`round trip ${JSON.stringify(variant)}`, nearPt(back, p, 1e-9));
}
{
  const line = shape({ shapeType: 'line', rotation: 90, height: 10 });
  const start = localToCanvas(line, { x: 0, y: 5 });
  check('line pivots on its start point', nearPt(start, { x: 100, y: 55 }, 1e-9));
}

console.log('\n[2] path data');
{
  const nodes: PathNode[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0, handleIn: { x: 5, y: -5 }, handleOut: { x: 15, y: 5 } },
    { x: 20, y: 20 },
  ];
  check('open path uses L for straight, C for curved', getPathNodesD(nodes, false) === 'M 0 0 C 0 0 5 -5 10 0 C 15 5 20 20 20 20');
  check('closed path ends with Z', getPathNodesD(nodes, true).endsWith('Z'));
  const geom = finalizePathGeometry(
    [
      { x: 50, y: 60 },
      { x: 150, y: 160 },
    ],
    false
  );
  check('finalize: bbox origin', geom.x === 50 && geom.y === 60 && geom.width === 100 && geom.height === 100);
  check('finalize: relative nodes', nearPt(geom.pathNodes[1], { x: 100, y: 100 }));
}

console.log('\n[3] SVG parsing (incl. relative commands and arcs)');
{
  const tri = parsePathDataToNodes('M 50 0 L 100 100 L 0 100 Z');
  check('triangle → 3 closed nodes', !!tri && tri.closed && tri.nodes.length === 3);
  const rel = parsePathDataToNodes('M 10 10 h 20 v 20 h -20 z');
  check('relative h/v', !!rel && rel.nodes.length === 4 && nearPt(rel.nodes[2], { x: 30, y: 30 }));
  const two = parsePathDataToNodes('M 0 0 L 1 1 Z M 5 5 L 6 6 Z');
  check('two outlines rejected', two === null);
  const arc = parsePathDataToNodes('M 0 50 A 50 50 0 0 1 100 50');
  check('arc converts to cubic segments', !!arc && arc.nodes.length >= 3);
  if (arc) {
    // every sampled point should sit on the circle centred (50, 50) r=50
    const segs = arc.nodes.length - 1;
    let worst = 0;
    for (let i = 0; i < segs; i++) {
      const c = segmentControls(arc.nodes, i);
      for (let s = 0; s <= 10; s++) {
        const q = cubicAt(c, s / 10);
        worst = Math.max(worst, Math.abs(Math.hypot(q.x - 50, q.y - 50) - 50));
      }
    }
    check('arc cubic stays on the circle (<0.1px)', worst < 0.1, `max error ${worst.toFixed(4)}`);
    check('arc bulges upward (sweep=1)', arc.nodes.some((n) => n.y < 1));
  }
}

console.log('\n[4] convert every shape type to a path');
const SHAPES: ShapeType[] = [
  'rect',
  'rounded-rect',
  'ellipse',
  'triangle',
  'diamond',
  'star',
  'arrow-right',
  'arrow-bidirectional',
  'speech-bubble',
  'heart',
  'hexagon',
];
for (const t of SHAPES) {
  const el = shape({ shapeType: t, cornerRadius: 16, rotation: 25 });
  const conv = convertShapeToPath(el);
  const ok = !!conv && conv.shapeType === 'path' && (conv.pathNodes?.length ?? 0) >= 3 && !!conv.pathClosed;
  check(`${t} → closed path`, ok, conv ? `${conv.pathNodes?.length} nodes` : 'null');
  if (conv) {
    check(`${t} keeps bbox & rotation`, conv.x === el.x && conv.width === el.width && conv.rotation === 25);
    const nodesFinite = conv.pathNodes!.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
    check(`${t} nodes finite`, nodesFinite);
  }
}
{
  const line = shape({
    shapeType: 'line',
    width: 100,
    height: 10,
    rotation: 30,
    points: [
      { x: 0, y: 5 },
      { x: 100, y: 5 },
    ],
  });
  const before = [localToCanvas(line, { x: 0, y: 5 }), localToCanvas(line, { x: 100, y: 5 })];
  const conv = convertShapeToPath(line)!;
  const after = conv.pathNodes!.map((n) => localToCanvas(conv, n));
  check('rotated line → path keeps endpoints on canvas', nearPt(before[0], after[0], 1) && nearPt(before[1], after[1], 1));
  check('line path is open & unfilled', !conv.pathClosed && conv.fill === 'none' && conv.rotation === 0);
  const poly = convertShapeToPath(
    shape({ shapeType: 'polyline', points: [{ x: 0, y: 0 }, { x: 50, y: 80 }, { x: 200, y: 10 }] })
  )!;
  check('polyline → 3 open nodes', poly.pathNodes!.length === 3 && !poly.pathClosed);
  check('arrow lines are not converted', convertShapeToPath(shape({ shapeType: 'line-arrow' })) === null);
}

console.log('\n[5] node editing keeps the curve where it was');
{
  const el = convertShapeToPath(shape({ shapeType: 'ellipse', rotation: 40, flipH: true }))!;
  const nodes = el.pathNodes!;
  const split = splitSegment(nodes, 1, 0.3);
  const c = segmentControls(nodes, 1);
  check('split adds one node', split.length === nodes.length + 1);
  check('split node lies on the original curve', nearPt(split[2], cubicAt(c, 0.3), 1e-9));
  // Check halves match original curve at a few parameters
  const left = segmentControls(split, 1);
  const right = segmentControls(split, 2);
  check(
    'split halves reproduce the curve',
    nearPt(cubicAt(left, 0.5), cubicAt(c, 0.15), 1e-9) && nearPt(cubicAt(right, 0.5), cubicAt(c, 0.65), 1e-9)
  );

  // Pull an anchor outside the bbox, refit, and make sure nothing moved on canvas
  const dragged = { ...el, pathNodes: nodes.map((n, i) => (i === 0 ? { ...n, x: n.x - 80, y: n.y - 60 } : n)) };
  const before = canvasOutline(dragged);
  const refit = refitPathElement(dragged);
  const after = canvasOutline(refit);
  const maxShift = Math.max(...before.map((p, i) => Math.hypot(p.x - after[i].x, p.y - after[i].y)));
  check('refit of rotated+flipped path keeps canvas position', maxShift < 1e-6, `shift ${maxShift}`);
  check('refit grows the bbox', refit.width > el.width || refit.height > el.height);
  const b = samplePathNodes(refit.pathNodes!, true, 24);
  check('refit bbox starts at 0,0', Math.min(...b.map((p) => p.x)) > -1 && Math.min(...b.map((p) => p.y)) > -1);

  const mirrored = moveHandle(nodes, 0, 'out', { x: nodes[0].x + 30, y: nodes[0].y + 10 }, false);
  const n0 = mirrored[0];
  const v1 = { x: n0.handleOut!.x - n0.x, y: n0.handleOut!.y - n0.y };
  const v2 = { x: n0.handleIn!.x - n0.x, y: n0.handleIn!.y - n0.y };
  check('smooth handle drag keeps handles collinear', near(v1.x * v2.y - v1.y * v2.x, 0, 1e-6) && v1.x * v2.x + v1.y * v2.y < 0);
  const corner = toggleNodeSmooth(nodes, true, 0);
  check('toggle smooth → corner removes handles', !corner[0].handleIn && !corner[0].handleOut);
  const smooth = toggleNodeSmooth(corner, true, 0);
  check('toggle corner → smooth adds handles', !!smooth[0].handleIn && !!smooth[0].handleOut);
  const hit = nearestOnPath(nodes, true, cubicAt(segmentControls(nodes, 2), 0.5));
  check('nearestOnPath finds the segment', !!hit && hit.segment === 2 && hit.dist < 0.5);
}

console.log('\n[6] lasso geometry');
{
  const square: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  check('point inside', pointInPolygon({ x: 50, y: 50 }, square));
  check('point outside', !pointInPolygon({ x: 150, y: 50 }, square));
  check('area', near(polygonArea(square), 10000));
  const bounds = clippedPolygonBounds(
    [
      { x: -20, y: 10 },
      { x: 50.4, y: 10 },
      { x: 50.4, y: 900 },
    ],
    800,
    600
  );
  check('bounds clip to canvas', !!bounds && bounds.x === 0 && bounds.w === 51 && bounds.h === 590);
  check('outline fully off canvas → null', clippedPolygonBounds([{ x: -50, y: -50 }, { x: -10, y: -50 }, { x: -10, y: -10 }], 800, 600) === null);
  const inside = shape({ x: 20, y: 20, width: 30, height: 30 });
  check('element fully inside', isElementInsidePolygon(inside, square));
  check('rotated element poking out is not inside', !isElementInsidePolygon(shape({ x: 20, y: 20, width: 75, height: 75, rotation: 45 }), square));
  const dense = Array.from({ length: 100 }, (_, i) => ({ x: i * 0.1, y: 0 }));
  check('simplify drops sub-pixel points', simplifyPolygon(dense, 1).length <= 11);
}

console.log('\n[7] history labels & jump');
{
  const config: CanvasConfig = {
    width: 800,
    height: 600,
    backgroundColor: '#fff',
    showGrid: false,
    showRulers: true,
    snapToGrid: false,
    gridSize: 20,
  };
  const layers: Layer[] = [{ id: 'layer-1', name: '레이어1', visible: true, locked: false, opacity: 1 }];
  const snap = (elements: CanvasElement[], cfg = config): HistorySnapshot => ({
    elements,
    layers,
    activeLayerId: 'layer-1',
    canvasConfig: cfg,
  });
  const a = shape({ id: 'a', name: '사각형' });
  const s0 = snap([]);
  const s1 = snap([a]);
  const s2 = snap([{ ...a, x: 140 }]);
  const s3 = snap([{ ...a, x: 140, width: 300 }]);
  const conv = convertShapeToPath({ ...a, x: 140, width: 300 })!;
  const s4 = snap([conv]);
  const s5 = snap([{ ...conv, pathNodes: conv.pathNodes!.map((n, i) => (i === 0 ? { ...n, x: n.x + 5 } : n)) }]);
  const s6 = snap([], config);
  const s7 = snap([], { ...config, width: 1024 });
  check('add', describeHistoryStep(s0, s1) === '사각형 추가', describeHistoryStep(s0, s1));
  check('move', describeHistoryStep(s1, s2) === '사각형 이동', describeHistoryStep(s1, s2));
  check('resize', describeHistoryStep(s2, s3) === '사각형 크기 조절', describeHistoryStep(s2, s3));
  check('convert', describeHistoryStep(s3, s4) === '사각형 형식 변환', describeHistoryStep(s3, s4));
  check('node edit', describeHistoryStep(s4, s5) === '사각형 점 편집', describeHistoryStep(s4, s5));
  check('clear', describeHistoryStep(s5, s6) === '캔버스 비우기', describeHistoryStep(s5, s6));
  check('canvas size', describeHistoryStep(s6, s7) === '캔버스 크기 1024×600', describeHistoryStep(s6, s7));

  let h = createHistory(s0);
  for (const s of [s1, s2, s3]) h = commitHistory(h, s);
  const jumped = jumpToHistory(h, 1);
  check('jump returns that snapshot', !!jumped && jumped.state.index === 1 && jumped.snapshot.elements[0].x === 100);
  check('jump keeps redo steps', !!jumped && jumped.state.snapshots.length === 4);
  check('jump to current index is a no-op', jumpToHistory(h, 3) === null);
  check('jump out of range rejected', jumpToHistory(h, 9) === null);
  if (jumped) {
    const branched = commitHistory(jumped.state, s1);
    check('editing after a jump drops the later steps', branched.snapshots.length === 3);
  }
}

console.log('\n[8] project files with pen paths');
{
  const base = {
    version: '1.0.0',
    config: { width: 800, height: 600, backgroundColor: '#fff', showGrid: false, showRulers: true, snapToGrid: false, gridSize: 20 },
    layers: [{ id: 'layer-1', name: '레이어1', visible: true, locked: false, opacity: 1 }],
  };
  const path = convertShapeToPath(shape({ shapeType: 'heart' }))!;
  check('valid path project accepted', validateProjectData({ ...base, elements: [path] }).ok);
  const noNodes = { ...path, pathNodes: undefined };
  check('path without nodes rejected', !validateProjectData({ ...base, elements: [noNodes] }).ok);
  const badHandle = { ...path, pathNodes: [{ x: 0, y: 0 }, { x: 5, y: 5, handleIn: { x: 'a', y: 1 } }] };
  check('bad handle rejected', !validateProjectData({ ...base, elements: [badHandle] }).ok);
  const oneNode = { ...path, pathNodes: [{ x: 0, y: 0 }] };
  check('single-node path rejected', !validateProjectData({ ...base, elements: [oneNode] }).ok);
}

console.log(failures === 0 ? '\nall pen/lasso/history checks passed' : `\n${failures} check(s) FAILED`);
if (failures > 0) process.exit(1);
