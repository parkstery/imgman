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

// ---------------------------------------------------------------------------
// Persistence (per browser). Stored values may come from an older build or be
// hand-edited, so every field is validated and falls back to its default.
// ---------------------------------------------------------------------------

export const STYLE_MEMORY_KEY = 'imgman.styleMemory';
const STYLE_MEMORY_VERSION = 1;

export interface StyleMemory {
  shape: ShapeStylePreset;
  line: LineStylePreset;
}

const DASHES = ['solid', 'dashed', 'dotted'] as const;
const CAPS: readonly LineCap[] = ['flat', 'round', 'square'];
const ARROW_TYPES = ['none', 'triangle', 'open', 'stealth', 'oval', 'diamond'] as const;
const ARROW_SIZES = ['small', 'medium', 'large'] as const;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A paint value: 'none' or a short CSS color string (hex, rgb(), named …). */
function paint(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const s = v.trim();
  if (!s || s.length > 64 || /[;{}<>]/.test(s)) return fallback;
  return s;
}
function color(v: unknown, fallback: string): string {
  const s = paint(v, fallback);
  return s === 'none' ? fallback : s;
}
function oneOf<T extends string>(v: unknown, list: readonly T[], fallback: T): T {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback;
}
function num(v: unknown, fallback: number, min: number, max: number): number {
  return isNum(v) && v >= min && v <= max ? v : fallback;
}

function sanitizeShadow(v: unknown): ShadowSettings | undefined {
  if (!isRec(v)) return undefined;
  return {
    enabled: v.enabled === true,
    color: color(v.color, 'rgba(0,0,0,0.35)'),
    blur: num(v.blur, 8, 0, 500),
    offsetX: num(v.offsetX, 4, -1000, 1000),
    offsetY: num(v.offsetY, 4, -1000, 1000),
  };
}

function sanitizeGradient(v: unknown): GradientSettings | undefined {
  if (!isRec(v) || v.enabled !== true) return undefined;
  return {
    enabled: true,
    type: oneOf(v.type, ['linear', 'radial'] as const, 'linear'),
    startColor: color(v.startColor, '#FFFFFF'),
    endColor: color(v.endColor, '#000000'),
    angle: num(v.angle, 90, 0, 360),
  };
}

function sanitizeArrow(v: unknown, fallback: ArrowConfig): ArrowConfig {
  if (!isRec(v)) return { ...fallback };
  return {
    type: oneOf(v.type, ARROW_TYPES, fallback.type),
    size: oneOf(v.size, ARROW_SIZES, fallback.size),
  };
}

export function sanitizeShapeStyle(v: unknown): ShapeStylePreset {
  const d = DEFAULT_SHAPE_STYLE;
  if (!isRec(v)) return { ...d };
  const out: ShapeStylePreset = {
    fill: paint(v.fill, d.fill),
    stroke: paint(v.stroke, d.stroke),
    strokeWidth: num(v.strokeWidth, d.strokeWidth, 0.1, 500),
    strokeDash: oneOf(v.strokeDash, DASHES, d.strokeDash),
    cornerRadius: num(v.cornerRadius, d.cornerRadius, 0, 10000),
    opacity: num(v.opacity, d.opacity, 0, 1),
  };
  const gradient = sanitizeGradient(v.gradient);
  if (gradient) out.gradient = gradient;
  const shadow = sanitizeShadow(v.shadow);
  if (shadow) out.shadow = shadow;
  return out;
}

export function sanitizeLineStyle(v: unknown): LineStylePreset {
  const d = DEFAULT_LINE_STYLE;
  if (!isRec(v)) return { ...d, beginArrow: { ...d.beginArrow }, endArrow: { ...d.endArrow } };
  const out: LineStylePreset = {
    stroke: color(v.stroke, d.stroke),
    strokeWidth: num(v.strokeWidth, d.strokeWidth, 0.1, 500),
    strokeDash: oneOf(v.strokeDash, DASHES, d.strokeDash),
    lineCap: oneOf(v.lineCap, CAPS, d.lineCap),
    opacity: num(v.opacity, d.opacity, 0, 1),
    beginArrow: sanitizeArrow(v.beginArrow, d.beginArrow),
    endArrow: sanitizeArrow(v.endArrow, d.endArrow),
  };
  const shadow = sanitizeShadow(v.shadow);
  if (shadow) out.shadow = shadow;
  return out;
}

/** Parse a stored memory string; anything broken becomes the defaults. */
export function parseStyleMemory(raw: string | null): StyleMemory {
  let data: unknown = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }
  const rec = isRec(data) ? data : {};
  return { shape: sanitizeShapeStyle(rec.shape), line: sanitizeLineStyle(rec.line) };
}

export function serializeStyleMemory(memory: StyleMemory): string {
  return JSON.stringify({ v: STYLE_MEMORY_VERSION, shape: memory.shape, line: memory.line });
}

export function loadStyleMemory(): StyleMemory {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STYLE_MEMORY_KEY);
  } catch {
    // Storage blocked (private mode etc.) — use the defaults.
  }
  return parseStyleMemory(raw);
}

export function saveStyleMemory(memory: StyleMemory): void {
  try {
    localStorage.setItem(STYLE_MEMORY_KEY, serializeStyleMemory(memory));
  } catch {
    // Ignore — memory still works for this session.
  }
}

/** Outline color for a new closed shape: avoid an invisible shape (no fill + no outline). */
export function resolveNewShapeStroke(style: ShapeStylePreset, fallback: string): string {
  const hasFill = (style.fill && style.fill !== 'none') || !!style.gradient?.enabled;
  if (style.stroke && style.stroke !== 'none') return style.stroke;
  return hasFill ? 'none' : fallback;
}
