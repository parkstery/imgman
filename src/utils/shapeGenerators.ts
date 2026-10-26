import { ShapeType, Point } from '../types';

export function getPolylinePath(points: Point[]): string {
  if (!points.length) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

/** Convert absolute canvas nodes into element bbox + relative points */
export function finalizePolylineGeometry(absolutePoints: Point[]): {
  x: number;
  y: number;
  width: number;
  height: number;
  points: Point[];
} {
  const xs = absolutePoints.map((p) => p.x);
  const ys = absolutePoints.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: Math.round(minX),
    y: Math.round(minY),
    width: Math.max(1, Math.round(maxX - minX)),
    height: Math.max(1, Math.round(maxY - minY)),
    points: absolutePoints.map((p) => ({
      x: Math.round(p.x - minX),
      y: Math.round(p.y - minY),
    })),
  };
}

/** SVG path for a circular arc from start → end */
export function getArcPath(
  start: Point,
  end: Point,
  radius: number,
  large: boolean,
  sweep: boolean
): string {
  const r = Math.max(0.5, radius);
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large ? 1 : 0} ${sweep ? 1 : 0} ${end.x} ${end.y}`;
}

/**
 * From chord (start–end) + bend point (controls side & sagitta),
 * compute circular arc radius and SVG flags.
 * R = L²/(8|h|) + |h|/2 where h is signed sagitta.
 */
export function computeArcFromChordAndBend(
  start: Point,
  end: Point,
  bend: Point
): { radius: number; large: boolean; sweep: boolean; apex: Point } | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const L = Math.hypot(dx, dy);
  if (L < 2) return null;

  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const nx = -dy / L;
  const ny = dx / L;

  let h = (bend.x - mx) * nx + (bend.y - my) * ny;
  const minH = Math.max(1, L * 0.02);
  if (Math.abs(h) < minH) {
    h = h >= 0 ? minH : -minH;
  }

  const absH = Math.abs(h);
  // Clamp so radius stays finite and drawable
  const radius = Math.min(50000, (L * L) / (8 * absH) + absH / 2);
  const apex = { x: mx + nx * h, y: my + ny * h };

  // Cross product: positive → bend is to the left of directed chord → sweep=1 in SVG y-down coords
  const cross = dx * (bend.y - start.y) - dy * (bend.x - start.x);
  const sweep = cross > 0;
  const halfChord = L / 2;

  return {
    radius: Math.max(halfChord + 0.01, radius),
    large: false,
    sweep,
    apex,
  };
}

/** Sample points along an SVG circular arc for bbox / hit testing */
export function sampleArcPoints(
  start: Point,
  end: Point,
  radius: number,
  large: boolean,
  sweep: boolean,
  segments = 24
): Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-6) return [start, end];

  const r = Math.max(radius, L / 2 + 1e-6);
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const d = L / 2;
  const h = Math.sqrt(Math.max(0, r * r - d * d));
  const ux = dx / L;
  const uy = dy / L;
  const nx = -uy;
  const ny = ux;

  const c1 = { x: mid.x + nx * h, y: mid.y + ny * h };
  const c2 = { x: mid.x - nx * h, y: mid.y - ny * h };

  const angleAt = (p: Point, c: Point) => Math.atan2(p.y - c.y, p.x - c.x);

  const build = (c: Point) => {
    let a0 = angleAt(start, c);
    let a1 = angleAt(end, c);
    let delta = a1 - a0;
    // atan2 increases counter-clockwise; SVG sweep=1 is clockwise → negative delta
    if (sweep) {
      while (delta > 0) delta -= Math.PI * 2;
      if (!large && delta > -1e-9) delta -= Math.PI * 2;
      if (!large && delta < -Math.PI) delta += Math.PI * 2;
      if (large && delta > -Math.PI) delta -= Math.PI * 2;
    } else {
      while (delta < 0) delta += Math.PI * 2;
      if (!large && delta < 1e-9) delta += Math.PI * 2;
      if (!large && delta > Math.PI) delta -= Math.PI * 2;
      if (large && delta < Math.PI) delta += Math.PI * 2;
    }
    return { c, a0, delta: Math.abs(delta) < 1e-9 ? (sweep ? -Math.PI * 2 : Math.PI * 2) : delta };
  };

  const t1 = build(c1);
  const t2 = build(c2);
  const trial = !large
    ? Math.abs(t1.delta) <= Math.abs(t2.delta)
      ? t1
      : t2
    : Math.abs(t1.delta) >= Math.abs(t2.delta)
      ? t1
      : t2;

  const points: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = trial.a0 + trial.delta * t;
    points.push({
      x: trial.c.x + r * Math.cos(a),
      y: trial.c.y + r * Math.sin(a),
    });
  }
  return points;
}

export function finalizeArcGeometry(
  start: Point,
  end: Point,
  radius: number,
  large: boolean,
  sweep: boolean
): {
  x: number;
  y: number;
  width: number;
  height: number;
  points: Point[];
  arcRadius: number;
  arcLarge: boolean;
  arcSweep: boolean;
} {
  const samples = sampleArcPoints(start, end, radius, large, sweep, 32);
  const xs = samples.map((p) => p.x);
  const ys = samples.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: Math.round(minX),
    y: Math.round(minY),
    width: Math.max(1, Math.round(maxX - minX)),
    height: Math.max(1, Math.round(maxY - minY)),
    points: [
      { x: Math.round(start.x - minX), y: Math.round(start.y - minY) },
      { x: Math.round(end.x - minX), y: Math.round(end.y - minY) },
    ],
    arcRadius: Math.round(radius * 100) / 100,
    arcLarge: large,
    arcSweep: sweep,
  };
}

export function getShapePath(
  shapeType: ShapeType,
  width: number,
  height: number,
  cornerRadius = 16,
  strokeWidth = 2
): string {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);

  switch (shapeType) {
    case 'rect':
      return `M 0 0 H ${w} V ${h} H 0 Z`;

    case 'rounded-rect': {
      const r = Math.min(cornerRadius, w / 2, h / 2);
      return `
        M ${r} 0
        H ${w - r}
        A ${r} ${r} 0 0 1 ${w} ${r}
        V ${h - r}
        A ${r} ${r} 0 0 1 ${w - r} ${h}
        H ${r}
        A ${r} ${r} 0 0 1 0 ${h - r}
        V ${r}
        A ${r} ${r} 0 0 1 ${r} 0
        Z
      `.replace(/\s+/g, ' ').trim();
    }

    case 'ellipse': {
      const rx = w / 2;
      const ry = h / 2;
      return `
        M ${rx} 0
        A ${rx} ${ry} 0 1 1 ${rx} ${h}
        A ${rx} ${ry} 0 1 1 ${rx} 0
        Z
      `.replace(/\s+/g, ' ').trim();
    }

    case 'triangle':
      return `M ${w / 2} 0 L ${w} ${h} L 0 ${h} Z`;

    case 'diamond':
      return `M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`;

    case 'star': {
      // 5-point star
      const cx = w / 2;
      const cy = h / 2;
      const outerR = Math.min(w, h) / 2;
      const innerR = outerR * 0.42;
      const points: string[] = [];
      for (let i = 0; i < 10; i++) {
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        const r = i % 2 === 0 ? outerR : innerR;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        points.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
      }
      return `${points.join(' ')} Z`;
    }

    case 'arrow-right': {
      const headW = w * 0.35;
      const shaftH = h * 0.45;
      const topY = (h - shaftH) / 2;
      const botY = topY + shaftH;
      return `
        M 0 ${topY}
        H ${w - headW}
        V 0
        L ${w} ${h / 2}
        L ${w - headW} ${h}
        V ${botY}
        H 0
        Z
      `.replace(/\s+/g, ' ').trim();
    }

    case 'arrow-bidirectional': {
      const headW = Math.min(w * 0.28, 40);
      const shaftH = h * 0.4;
      const topY = (h - shaftH) / 2;
      const botY = topY + shaftH;
      return `
        M 0 ${h / 2}
        L ${headW} 0
        V ${topY}
        H ${w - headW}
        V 0
        L ${w} ${h / 2}
        L ${w - headW} ${h}
        V ${botY}
        H ${headW}
        V ${h}
        Z
      `.replace(/\s+/g, ' ').trim();
    }

    case 'speech-bubble': {
      const bubbleH = h * 0.8;
      const r = Math.min(16, w / 4, bubbleH / 4);
      return `
        M ${r} 0
        H ${w - r}
        A ${r} ${r} 0 0 1 ${w} ${r}
        V ${bubbleH - r}
        A ${r} ${r} 0 0 1 ${w - r} ${bubbleH}
        H ${w * 0.45}
        L ${w * 0.25} ${h}
        L ${w * 0.3} ${bubbleH}
        H ${r}
        A ${r} ${r} 0 0 1 0 ${bubbleH - r}
        V ${r}
        A ${r} ${r} 0 0 1 ${r} 0
        Z
      `.replace(/\s+/g, ' ').trim();
    }

    case 'heart': {
      const topCurveH = h * 0.3;
      return `
        M ${w / 2} ${h}
        C ${w / 2} ${h * 0.75} 0 ${h * 0.6} 0 ${topCurveH}
        C 0 0 ${w / 2} 0 ${w / 2} ${topCurveH}
        C ${w / 2} 0 ${w} 0 ${w} ${topCurveH}
        C ${w} ${h * 0.6} ${w / 2} ${h * 0.75} ${w / 2} ${h}
        Z
      `.replace(/\s+/g, ' ').trim();
    }

    case 'hexagon': {
      const side = w * 0.25;
      return `
        M ${side} 0
        H ${w - side}
        L ${w} ${h / 2}
        L ${w - side} ${h}
        H ${side}
        L 0 ${h / 2}
        Z
      `.replace(/\s+/g, ' ').trim();
    }

    case 'line':
      return `M 0 ${h / 2} L ${w} ${h / 2}`;

    case 'line-arrow': {
      // Line with clean arrowhead at end
      const baseSize = Math.min(14, Math.max(8, w * 0.2));
      const headSize = baseSize * (strokeWidth / 2);
      return `
        M 0 ${h / 2}
        L ${w} ${h / 2}
        M ${w - headSize} ${h / 2 - headSize * 0.6}
        L ${w} ${h / 2}
        L ${w - headSize} ${h / 2 + headSize * 0.6}
      `.replace(/\s+/g, ' ').trim();
    }

    case 'line-arrow-both': {
      // Line with arrowheads at both ends
      const baseSize = Math.min(14, Math.max(8, w * 0.2));
      const headSize = baseSize * (strokeWidth / 2);
      return `
        M 0 ${h / 2}
        L ${w} ${h / 2}
        M ${headSize} ${h / 2 - headSize * 0.6}
        L 0 ${h / 2}
        L ${headSize} ${h / 2 + headSize * 0.6}
        M ${w - headSize} ${h / 2 - headSize * 0.6}
        L ${w} ${h / 2}
        L ${w - headSize} ${h / 2 + headSize * 0.6}
      `.replace(/\s+/g, ' ').trim();
    }

    case 'line-arrow-start': {
      // Line with arrowhead at start
      const baseSize = Math.min(14, Math.max(8, w * 0.2));
      const headSize = baseSize * (strokeWidth / 2);
      return `
        M 0 ${h / 2}
        L ${w} ${h / 2}
        M ${headSize} ${h / 2 - headSize * 0.6}
        L 0 ${h / 2}
        L ${headSize} ${h / 2 + headSize * 0.6}
      `.replace(/\s+/g, ' ').trim();
    }

    case 'line-arrow-open': {
      // Line with open arrowhead (V shape) at end
      const baseSize = Math.min(14, Math.max(8, w * 0.2));
      const headSize = baseSize * (strokeWidth / 2);
      return `
        M 0 ${h / 2}
        L ${w} ${h / 2}
        M ${w - headSize} ${h / 2 - headSize * 0.6}
        L ${w} ${h / 2}
        L ${w - headSize} ${h / 2 + headSize * 0.6}
      `.replace(/\s+/g, ' ').trim();
    }

    case 'line-arrow-dot': {
      // Line with dot at end
      const baseR = Math.min(6, Math.max(3, w * 0.08));
      const dotR = baseR * (strokeWidth / 2);
      return `
        M 0 ${h / 2}
        L ${w - dotR} ${h / 2}
        M ${w} ${h / 2}
        m -${dotR} 0
        a ${dotR} ${dotR} 0 1 0 ${dotR * 2} 0
        a ${dotR} ${dotR} 0 1 0 -${dotR * 2} 0
      `.replace(/\s+/g, ' ').trim();
    }

    case 'line-arrow-diamond': {
      // Line with diamond at end
      const baseD = Math.min(12, Math.max(6, w * 0.15));
      const d = baseD * (strokeWidth / 2);
      return `
        M 0 ${h / 2}
        L ${w - d} ${h / 2}
        M ${w - d} ${h / 2}
        L ${w} ${h / 2 - d * 0.6}
        L ${w + d} ${h / 2}
        L ${w} ${h / 2 + d * 0.6}
        Z
      `.replace(/\s+/g, ' ').trim();
    }

    case 'polyline':
      // Path is built from ShapeElement.points via getPolylinePath
      return `M 0 0 L ${w} ${h}`;

    case 'arc':
      // Path is built from points + arcRadius via getArcPath
      return `M 0 ${h / 2} A ${w / 2} ${h / 2} 0 0 1 ${w} ${h / 2}`;

    default:
      return `M 0 0 H ${w} V ${h} H 0 Z`;
  }
}
