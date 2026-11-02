/**
 * "Last chosen style" memory for new drawings (PowerPoint-like).
 *
 * Two buckets so they never clobber each other:
 *  - ShapeStylePreset — 채우기(fill/gradient) + 윤곽선(outline) of closed shapes & pen paths
 *  - LineStylePreset  — 선 (line / arrow / polyline / arc)
 *
 * Only properties the user actually CHANGES are recorded. Selecting, moving or
 * resizing an element never rewrites the memory, and choosing "none"
 * (투명 채우기 / 선 없음) is remembered like any other choice.
 */
import type {
  ArrowConfig,
  GradientSettings,
  LineCap,
  ShadowSettings,
  ShapeElement,
  ShapeStylePreset,
  ShapeType,
} from '../types';

export interface LineStylePreset {
  stroke: string;
  strokeWidth: number;
  strokeDash: 'solid' | 'dashed' | 'dotted';
  lineCap: LineCap;
  opacity: number;
  shadow?: ShadowSettings;
  /** Heads used by the plain "화살표 선" (line-arrow) tool. */
  beginArrow: ArrowConfig;
  endArrow: ArrowConfig;
}

export const DEFAULT_SHAPE_STYLE: ShapeStylePreset = {
  fill: 'none',
  stroke: '#FF0000',
  strokeWidth: 2,
  strokeDash: 'solid',
  cornerRadius: 16,
  opacity: 1,
};

export const DEFAULT_LINE_STYLE: LineStylePreset = {
  stroke: '#FF0000',
  strokeWidth: 2,
  strokeDash: 'solid',
  lineCap: 'round',
  opacity: 1,
  beginArrow: { type: 'none', size: 'medium' },
  endArrow: { type: 'triangle', size: 'medium' },
};

export function isLineShapeType(t: ShapeType): boolean {
  return t === 'line' || t.startsWith('line-arrow') || t === 'polyline' || t === 'arc';
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function cloneGradient(g: GradientSettings | undefined): GradientSettings | undefined {
  return g ? { ...g } : undefined;
}

/** Record fill / outline choices made on a closed shape (or pen path). */
export function recordShapeStyleChange(
  prev: ShapeStylePreset,
  before: ShapeElement,
  after: ShapeElement
): ShapeStylePreset {
  let next = prev;
  const set = (patch: Partial<ShapeStylePreset>) => {
    next = { ...next, ...patch };
  };

  const fillChanged = before.fill !== after.fill;
  const gradientChanged = !same(before.gradient, after.gradient);
  if (fillChanged || gradientChanged) {
    set({
      fill: after.fill || 'none',
      gradient: after.gradient?.enabled ? cloneGradient(after.gradient) : undefined,
    });
  }
  if (before.stroke !== after.stroke) set({ stroke: after.stroke || 'none' });
  if (before.strokeWidth !== after.strokeWidth && after.strokeWidth > 0) {
    set({ strokeWidth: after.strokeWidth });
  }
  if (before.strokeDash !== after.strokeDash) set({ strokeDash: after.strokeDash });
  if (before.cornerRadius !== after.cornerRadius && after.cornerRadius !== undefined) {
    set({ cornerRadius: after.cornerRadius });
  }
  if (before.opacity !== after.opacity) set({ opacity: after.opacity });
  if (!same(before.shadow, after.shadow)) set({ shadow: after.shadow ? { ...after.shadow } : undefined });
  return next;
}

/** Record choices made on a line / arrow / polyline / arc. */
export function recordLineStyleChange(
  prev: LineStylePreset,
  before: ShapeElement,
  after: ShapeElement
): LineStylePreset {
  let next = prev;
  const set = (patch: Partial<LineStylePreset>) => {
    next = { ...next, ...patch };
  };

  if (before.stroke !== after.stroke && after.stroke && after.stroke !== 'none') {
    set({ stroke: after.stroke });
  }
  if (before.strokeWidth !== after.strokeWidth && after.strokeWidth > 0) {
    set({ strokeWidth: after.strokeWidth });
  }
  if (before.strokeDash !== after.strokeDash) set({ strokeDash: after.strokeDash });
  if (before.lineCap !== after.lineCap && after.lineCap) set({ lineCap: after.lineCap });
  if (before.opacity !== after.opacity) set({ opacity: after.opacity });
  if (!same(before.shadow, after.shadow)) set({ shadow: after.shadow ? { ...after.shadow } : undefined });
  // Arrow heads: remember them for the plain "화살표 선" tool, but only from
  // arrow lines (a plain line's empty heads must not erase the arrow memory).
  if (after.shapeType.startsWith('line-arrow')) {
    if (!same(before.beginArrow, after.beginArrow) && after.beginArrow) {
      set({ beginArrow: { ...after.beginArrow } });
    }
    if (!same(before.endArrow, after.endArrow) && after.endArrow) {
      set({ endArrow: { ...after.endArrow } });
    }
  }
  return next;
}

/** Remember the heads of a freshly drawn arrow (next plain arrow reuses them). */
export function recordDrawnArrowHeads(prev: LineStylePreset, drawn: ShapeElement): LineStylePreset {
  if (!drawn.shapeType.startsWith('line-arrow') || !drawn.beginArrow || !drawn.endArrow) return prev;
  if (same(prev.beginArrow, drawn.beginArrow) && same(prev.endArrow, drawn.endArrow)) return prev;
  return { ...prev, beginArrow: { ...drawn.beginArrow }, endArrow: { ...drawn.endArrow } };
}

/**
 * Toolbar color pick for closed shapes: it becomes the fill, or the outline when
 * the remembered fill is "none" (same rule the toolbar uses for a selected shape).
 * Lines simply take the color as their stroke.
 */
export function applyToolbarColorToShape(shape: ShapeStylePreset, color: string): ShapeStylePreset {
  const outlineOnly = shape.fill === 'none' && !shape.gradient?.enabled;
  if (outlineOnly) return { ...shape, stroke: color };
  return {
    ...shape,
    fill: color,
    gradient: shape.gradient ? { ...shape.gradient, enabled: false, startColor: color } : undefined,
  };
}

/** Outline color for a new closed shape: avoid an invisible shape (no fill + no outline). */
export function resolveNewShapeStroke(style: ShapeStylePreset, fallback: string): string {
  const hasFill = (style.fill && style.fill !== 'none') || !!style.gradient?.enabled;
  if (style.stroke && style.stroke !== 'none') return style.stroke;
  return hasFill ? 'none' : fallback;
}
