import { PathNode, Point, ShapeElement } from '../types';
import { getArcPath, getShapePath } from './shapeGenerators';
import { getRotationPivot, localToCanvas } from './elementGeometry';

/** Cubic Bezier circle constant */
const KAPPA = 0.5522847498;

const fmt = (n: number) => String(Math.round(n * 100) / 100);

export function clonePathNodes(nodes: PathNode[]): PathNode[] {
  return nodes.map((n) => ({
    x: n.x,
    y: n.y,
    ...(n.handleIn ? { handleIn: { ...n.handleIn } } : {}),
    ...(n.handleOut ? { handleOut: { ...n.handleOut } } : {}),
  }));
}

/** Number of drawable segments (closed paths also join last → first). */
export function segmentCount(nodes: PathNode[], closed: boolean): number {
  if (nodes.length < 2) return 0;
  return closed ? nodes.length : nodes.length - 1;
}

/** The four control points of segment i. */
export function segmentControls(nodes: PathNode[], i: number): [Point, Point, Point, Point] {
  const a = nodes[i];
  const b = nodes[(i + 1) % nodes.length];
  return [
    { x: a.x, y: a.y },
    a.handleOut ? { ...a.handleOut } : { x: a.x, y: a.y },
    b.handleIn ? { ...b.handleIn } : { x: b.x, y: b.y },
    { x: b.x, y: b.y },
  ];
}

function isStraight(nodes: PathNode[], i: number): boolean {
  const a = nodes[i];
  const b = nodes[(i + 1) % nodes.length];
  return !a.handleOut && !b.handleIn;
}

export function cubicAt(c: [Point, Point, Point, Point], t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x,
    y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y,
  };
}

/** SVG path data for pen nodes. */
export function getPathNodesD(nodes: PathNode[], closed: boolean): string {
  if (nodes.length === 0) return '';
  const parts = [`M ${fmt(nodes[0].x)} ${fmt(nodes[0].y)}`];
  const segs = segmentCount(nodes, closed);
  for (let i = 0; i < segs; i++) {
    const [, c1, c2, p] = segmentControls(nodes, i);
    if (isStraight(nodes, i)) {
      parts.push(`L ${fmt(p.x)} ${fmt(p.y)}`);
    } else {
      parts.push(`C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(p.x)} ${fmt(p.y)}`);
    }
  }
  if (closed && nodes.length > 1) parts.push('Z');
  return parts.join(' ');
}

/** Points along the drawn curve (anchors included). */
export function samplePathNodes(nodes: PathNode[], closed: boolean, steps = 24): Point[] {
  if (nodes.length === 0) return [];
  const out: Point[] = [{ x: nodes[0].x, y: nodes[0].y }];
  const segs = segmentCount(nodes, closed);
  for (let i = 0; i < segs; i++) {
    const c = segmentControls(nodes, i);
    if (isStraight(nodes, i)) {
      out.push(c[3]);
      continue;
    }
    for (let s = 1; s <= steps; s++) out.push(cubicAt(c, s / steps));
  }
  return out;
}

export function pathNodesBounds(nodes: PathNode[], closed: boolean): { minX: number; minY: number; maxX: number; maxY: number } {
  const pts = samplePathNodes(nodes, closed);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

function translateNodes(nodes: PathNode[], dx: number, dy: number): PathNode[] {
  const move = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
  return nodes.map((n) => ({
    x: n.x + dx,
    y: n.y + dy,
    ...(n.handleIn ? { handleIn: move(n.handleIn) } : {}),
    ...(n.handleOut ? { handleOut: move(n.handleOut) } : {}),
  }));
}

export function scalePathNodes(nodes: PathNode[], sx: number, sy: number): PathNode[] {
  const scale = (p: Point) => ({ x: p.x * sx, y: p.y * sy });
  return nodes.map((n) => ({
    ...scale(n),
    ...(n.handleIn ? { handleIn: scale(n.handleIn) } : {}),
    ...(n.handleOut ? { handleOut: scale(n.handleOut) } : {}),
  }));
}

/** Absolute canvas nodes → element bbox + relative nodes. */
export function finalizePathGeometry(absNodes: PathNode[], closed: boolean): {
  x: number;
  y: number;
  width: number;
  height: number;
  pathNodes: PathNode[];
} {
  const b = pathNodesBounds(absNodes, closed);
  const x = Math.floor(b.minX);
  const y = Math.floor(b.minY);
  return {
    x,
    y,
    width: Math.max(1, Math.ceil(b.maxX) - x),
    height: Math.max(1, Math.ceil(b.maxY) - y),
    pathNodes: translateNodes(absNodes, -x, -y),
  };
}

/**
 * Shrink/grow the bbox to the edited curve while keeping every node at the
 * same place on the canvas (works for rotated and flipped paths).
 */
export function refitPathElement(el: ShapeElement): ShapeElement {
  if (!el.pathNodes || el.pathNodes.length === 0) return el;
  const b = pathNodesBounds(el.pathNodes, !!el.pathClosed);
  const minX = Math.floor(b.minX);
  const minY = Math.floor(b.minY);
  const w = Math.max(1, Math.ceil(b.maxX) - minX);
  const h = Math.max(1, Math.ceil(b.maxY) - minY);
  if (minX === 0 && minY === 0 && w === el.width && h === el.height) return el;

  const next: ShapeElement = {
    ...el,
    width: w,
    height: h,
    pathNodes: translateNodes(el.pathNodes, -minX, -minY),
  };
  // Keep node (0-relative) canvas position fixed: solve for the new x/y.
  const anchorBefore = localToCanvas(el, { x: el.pathNodes[0].x, y: el.pathNodes[0].y });
  const probe = localToCanvas({ ...next, x: 0, y: 0 }, next.pathNodes![0]);
  next.x = anchorBefore.x - probe.x;
  next.y = anchorBefore.y - probe.y;
  return next;
}

/* ------------------------------------------------------------------------ */
/* Editing helpers                                                          */
/* ------------------------------------------------------------------------ */

/** Nearest point on the curve: segment index, parameter t and distance. */
export function nearestOnPath(
  nodes: PathNode[],
  closed: boolean,
  p: Point,
  steps = 40
): { segment: number; t: number; dist: number; point: Point } | null {
  const segs = segmentCount(nodes, closed);
  let best: { segment: number; t: number; dist: number; point: Point } | null = null;
  for (let i = 0; i < segs; i++) {
    const c = segmentControls(nodes, i);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const q = cubicAt(c, t);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (!best || d < best.dist) best = { segment: i, t, dist: d, point: q };
    }
  }
  return best;
}

const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Insert an anchor on segment i at parameter t without changing the curve. */
export function splitSegment(nodes: PathNode[], i: number, t: number): PathNode[] {
  const next = clonePathNodes(nodes);
  const j = (i + 1) % next.length;
  if (isStraight(next, i)) {
    const p = lerp(next[i], next[j], t);
    next.splice(i + 1, 0, { x: p.x, y: p.y });
    return next;
  }
  const [p0, p1, p2, p3] = segmentControls(next, i);
  const p01 = lerp(p0, p1, t);
  const p12 = lerp(p1, p2, t);
  const p23 = lerp(p2, p3, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const mid = lerp(p012, p123, t);
  next[i].handleOut = p01;
  next[j].handleIn = p23;
  next.splice(i + 1, 0, { x: mid.x, y: mid.y, handleIn: p012, handleOut: p123 });
  return next;
}

/** Corner → smooth (handles along the neighbour direction) or smooth → corner. */
export function toggleNodeSmooth(nodes: PathNode[], closed: boolean, index: number): PathNode[] {
  const next = clonePathNodes(nodes);
  const n = next[index];
  if (n.handleIn || n.handleOut) {
    delete n.handleIn;
    delete n.handleOut;
    return next;
  }
  const count = next.length;
  const prev = index > 0 ? next[index - 1] : closed ? next[count - 1] : null;
  const after = index < count - 1 ? next[index + 1] : closed ? next[0] : null;
  const from = prev ?? n;
  const to = after ?? n;
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    dx = 1;
    dy = 0;
  } else {
    dx /= len;
    dy /= len;
  }
  const inLen = prev ? Math.hypot(n.x - prev.x, n.y - prev.y) / 3 : 0;
  const outLen = after ? Math.hypot(after.x - n.x, after.y - n.y) / 3 : 0;
  if (prev) n.handleIn = { x: n.x - dx * inLen, y: n.y - dy * inLen };
  if (after) n.handleOut = { x: n.x + dx * outLen, y: n.y + dy * outLen };
  return next;
}

/** Move an anchor and carry its handles along. */
export function moveNode(nodes: PathNode[], index: number, to: Point): PathNode[] {
  const next = clonePathNodes(nodes);
  const n = next[index];
  const dx = to.x - n.x;
  const dy = to.y - n.y;
  n.x = to.x;
  n.y = to.y;
  if (n.handleIn) n.handleIn = { x: n.handleIn.x + dx, y: n.handleIn.y + dy };
  if (n.handleOut) n.handleOut = { x: n.handleOut.x + dx, y: n.handleOut.y + dy };
  return next;
}

/**
 * Drag one handle. Unless `breakSymmetry`, the opposite handle stays collinear
 * (keeping its own length) so the node remains smooth.
 */
export function moveHandle(
  nodes: PathNode[],
  index: number,
  which: 'in' | 'out',
  to: Point,
  breakSymmetry: boolean
): PathNode[] {
  const next = clonePathNodes(nodes);
  const n = next[index];
  if (which === 'in') n.handleIn = { ...to };
  else n.handleOut = { ...to };
  if (breakSymmetry) return next;
  const other = which === 'in' ? n.handleOut : n.handleIn;
  if (!other) return next;
  const vx = n.x - to.x;
  const vy = n.y - to.y;
  const vlen = Math.hypot(vx, vy);
  if (vlen < 1e-6) return next;
  const olen = Math.hypot(other.x - n.x, other.y - n.y);
  const mirrored = { x: n.x + (vx / vlen) * olen, y: n.y + (vy / vlen) * olen };
  if (which === 'in') n.handleOut = mirrored;
  else n.handleIn = mirrored;
  return next;
}

/** Remove an anchor; returns null when fewer than two would remain. */
export function deleteNode(nodes: PathNode[], index: number): PathNode[] | null {
  if (nodes.length <= 2) return null;
  const next = clonePathNodes(nodes);
  next.splice(index, 1);
  return next;
}

/* ------------------------------------------------------------------------ */
/* Convert existing shapes                                                  */
/* ------------------------------------------------------------------------ */

type Cubic = { from: Point; c1: Point; c2: Point; to: Point };

/** Endpoint arc → cubic segments (SVG implementation notes F.6.5). */
function arcToCubics(
  from: Point,
  rxIn: number,
  ryIn: number,
  phiDeg: number,
  large: boolean,
  sweep: boolean,
  to: Point
): Cubic[] {
  if (from.x === to.x && from.y === to.y) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx < 1e-9 || ry < 1e-9) return [{ from, c1: from, c2: to, to }];
  const phi = (phiDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx2 = (from.x - to.x) / 2;
  const dy2 = (from.y - to.y) / 2;
  const x1p = cosP * dx2 + sinP * dy2;
  const y1p = -sinP * dx2 + cosP * dy2;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (from.x + to.x) / 2;
  const cy = sinP * cxp + cosP * cyp + (from.y + to.y) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  const segs = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2) - 1e-9));
  const delta = dTheta / segs;
  const alpha = (4 / 3) * Math.tan(delta / 4);
  const pointAt = (t: number) => {
    const ct = Math.cos(t);
    const st = Math.sin(t);
    return {
      x: cx + rx * ct * cosP - ry * st * sinP,
      y: cy + rx * ct * sinP + ry * st * cosP,
    };
  };
  const derivAt = (t: number) => {
    const ct = Math.cos(t);
    const st = Math.sin(t);
    return {
      x: -rx * st * cosP - ry * ct * sinP,
      y: -rx * st * sinP + ry * ct * cosP,
    };
  };
  const out: Cubic[] = [];
  let t = theta1;
  let prev = from;
  for (let i = 0; i < segs; i++) {
    const t2 = t + delta;
    const end = i === segs - 1 ? to : pointAt(t2);
    const d1 = derivAt(t);
    const d2 = derivAt(t2);
    out.push({
      from: prev,
      c1: { x: prev.x + alpha * d1.x, y: prev.y + alpha * d1.y },
      c2: { x: end.x - alpha * d2.x, y: end.y - alpha * d2.y },
      to: end,
    });
    prev = end;
    t = t2;
  }
  return out;
}

/**
 * Parse SVG path data (absolute/relative M L H V C S Q T A Z) into pen nodes.
 * Only single-subpath outlines convert; anything else returns null.
 */
export function parsePathDataToNodes(d: string): { nodes: PathNode[]; closed: boolean } | null {
  const tokens = d.match(/[MLHVCSQTAZmlhvcsqtaz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!tokens || tokens.length === 0) return null;
  let i = 0;
  const num = () => {
    const v = parseFloat(tokens[i++]);
    if (!Number.isFinite(v)) throw new Error('bad number');
    return v;
  };
  const isNum = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]);

  const nodes: PathNode[] = [];
  let cur: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let lastCtrl: Point | null = null;
  let lastQuad: Point | null = null;
  let closed = false;
  let cmd = '';

  const lineTo = (p: Point) => {
    nodes.push({ x: p.x, y: p.y });
    cur = p;
  };
  const cubicTo = (c1: Point, c2: Point, p: Point) => {
    const prev = nodes[nodes.length - 1];
    if (prev) prev.handleOut = { ...c1 };
    nodes.push({ x: p.x, y: p.y, handleIn: { ...c2 } });
    cur = p;
  };

  try {
    while (i < tokens.length) {
      if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
      else if (!cmd) return null;
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      const ox = rel ? cur.x : 0;
      const oy = rel ? cur.y : 0;
      switch (C) {
        case 'M': {
          // A second outline (holes, multi-part shapes) cannot become one path
          if (closed || nodes.length > 0) return null;
          const p = { x: num() + ox, y: num() + oy };
          nodes.push({ x: p.x, y: p.y });
          cur = p;
          start = p;
          cmd = rel ? 'l' : 'L';
          lastCtrl = lastQuad = null;
          break;
        }
        case 'L':
          lineTo({ x: num() + ox, y: num() + oy });
          lastCtrl = lastQuad = null;
          break;
        case 'H':
          lineTo({ x: num() + ox, y: cur.y });
          lastCtrl = lastQuad = null;
          break;
        case 'V':
          lineTo({ x: cur.x, y: num() + oy });
          lastCtrl = lastQuad = null;
          break;
        case 'C': {
          const c1 = { x: num() + ox, y: num() + oy };
          const c2 = { x: num() + ox, y: num() + oy };
          const p = { x: num() + ox, y: num() + oy };
          cubicTo(c1, c2, p);
          lastCtrl = c2;
          lastQuad = null;
          break;
        }
        case 'S': {
          const c1 = lastCtrl ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : { ...cur };
          const c2 = { x: num() + ox, y: num() + oy };
          const p = { x: num() + ox, y: num() + oy };
          cubicTo(c1, c2, p);
          lastCtrl = c2;
          lastQuad = null;
          break;
        }
        case 'Q':
        case 'T': {
          const q =
            C === 'Q'
              ? { x: num() + ox, y: num() + oy }
              : lastQuad
                ? { x: 2 * cur.x - lastQuad.x, y: 2 * cur.y - lastQuad.y }
                : { ...cur };
          const p = { x: num() + ox, y: num() + oy };
          const from = cur;
          cubicTo(lerp(from, q, 2 / 3), lerp(p, q, 2 / 3), p);
          lastQuad = q;
          lastCtrl = null;
          break;
        }
        case 'A': {
          const rx = num();
          const ry = num();
          const rot = num();
          const large = num() !== 0;
          const sweep = num() !== 0;
          const p = { x: num() + ox, y: num() + oy };
          for (const c of arcToCubics(cur, rx, ry, rot, large, sweep, p)) cubicTo(c.c1, c.c2, c.to);
          cur = p;
          lastCtrl = lastQuad = null;
          break;
        }
        case 'Z':
          closed = true;
          cur = start;
          lastCtrl = lastQuad = null;
          // A further command after Z would start a second outline
          if (i < tokens.length) return null;
          break;
        default:
          return null;
      }
      // Implicit repeats ("L 1 2 3 4") keep the same command letter
      if (C === 'Z' && isNum()) return null;
    }
  } catch {
    return null;
  }

  if (nodes.length < 2) return null;
  // Closing segment back onto the start anchor: merge the duplicate node
  if (closed && nodes.length > 2) {
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) {
      if (last.handleIn) first.handleIn = last.handleIn;
      nodes.pop();
    }
  }
  return { nodes, closed };
}

/** Shapes the "패스로 변환" command understands. */
export function canConvertToPath(el: ShapeElement): boolean {
  if (el.shapeType === 'path') return false;
  if (el.shapeType.startsWith('line-arrow')) return false;
  return true;
}

/**
 * Turn a shape into an editable pen path with the same look. Straight lines
 * (which rotate about their start point) are re-based to rotation 0.
 */
export function convertShapeToPath(el: ShapeElement): ShapeElement | null {
  if (!canConvertToPath(el)) return null;
  const base = {
    ...el,
    shapeType: 'path' as const,
    points: undefined,
    arcRadius: undefined,
    arcLarge: undefined,
    arcSweep: undefined,
    beginArrow: undefined,
    endArrow: undefined,
    lineCap: undefined,
  };

  if (el.shapeType === 'line') {
    const pv = getRotationPivot(el);
    const p0 = el.points && el.points.length >= 2 ? el.points[0] : pv;
    const p1 =
      el.points && el.points.length >= 2
        ? el.points[el.points.length - 1]
        : { x: el.width, y: el.height / 2 };
    const a = localToCanvas(el, p0);
    const b = localToCanvas(el, p1);
    const geom = finalizePathGeometry([{ ...a }, { ...b }], false);
    return {
      ...base,
      ...geom,
      rotation: 0,
      flipH: false,
      flipV: false,
      pathClosed: false,
      fill: 'none',
      name: el.name,
    };
  }

  let parsed: { nodes: PathNode[]; closed: boolean } | null = null;
  if (el.shapeType === 'polyline' && el.points && el.points.length >= 2) {
    parsed = { nodes: el.points.map((p) => ({ x: p.x, y: p.y })), closed: false };
  } else if (el.shapeType === 'arc' && el.points && el.points.length >= 2 && el.arcRadius != null) {
    parsed = parsePathDataToNodes(
      getArcPath(el.points[0], el.points[1], el.arcRadius, !!el.arcLarge, !!el.arcSweep)
    );
    if (parsed) parsed.closed = false;
  } else if (el.shapeType === 'ellipse') {
    const rx = el.width / 2;
    const ry = el.height / 2;
    const kx = rx * KAPPA;
    const ky = ry * KAPPA;
    parsed = {
      closed: true,
      nodes: [
        { x: rx, y: 0, handleIn: { x: rx - kx, y: 0 }, handleOut: { x: rx + kx, y: 0 } },
        { x: el.width, y: ry, handleIn: { x: el.width, y: ry - ky }, handleOut: { x: el.width, y: ry + ky } },
        { x: rx, y: el.height, handleIn: { x: rx + kx, y: el.height }, handleOut: { x: rx - kx, y: el.height } },
        { x: 0, y: ry, handleIn: { x: 0, y: ry + ky }, handleOut: { x: 0, y: ry - ky } },
      ],
    };
  } else {
    parsed = parsePathDataToNodes(
      getShapePath(el.shapeType, el.width, el.height, el.cornerRadius, el.strokeWidth)
    );
  }
  if (!parsed) return null;

  return {
    ...base,
    pathNodes: parsed.nodes,
    pathClosed: parsed.closed,
    fill: parsed.closed ? el.fill : 'none',
    gradient: parsed.closed ? el.gradient : undefined,
  };
}

/** Is this path drawn like a line (open, no fill)? */
export function isOpenPath(el: { type: string; shapeType?: string; pathClosed?: boolean }): boolean {
  return el.type === 'shape' && el.shapeType === 'path' && !el.pathClosed;
}
