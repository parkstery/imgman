import { ArrowType, ArrowSize, ArrowConfig, LineCap, Point } from '../types';

/** No arrow head (used for either end of a plain line). */
export const NO_ARROW: ArrowConfig = { type: 'none', size: 'medium' };

/** Shorthand for building an arrow head configuration. */
export function makeArrow(type: ArrowType, size: ArrowSize = 'medium'): ArrowConfig {
  return { type, size };
}

/**
 * PowerPoint-style presets for the toolbar / properties panel.
 * Every preset declares BOTH ends explicitly so that the previous
 * default arrow heads can never leak into the new line.
 */
const ARROW_PRESETS: Record<string, { begin: ArrowConfig; end: ArrowConfig }> = {
  line: { begin: makeArrow('none'), end: makeArrow('none') },
  'line-arrow': { begin: makeArrow('none'), end: makeArrow('triangle') },
  'line-arrow-both': { begin: makeArrow('triangle'), end: makeArrow('triangle') },
  'line-arrow-start': { begin: makeArrow('triangle'), end: makeArrow('none') },
  'line-arrow-open': { begin: makeArrow('none'), end: makeArrow('open') },
  'line-arrow-dot': { begin: makeArrow('none'), end: makeArrow('oval') },
  'line-arrow-diamond': { begin: makeArrow('none'), end: makeArrow('diamond') },
};

/** Explicit begin/end configuration for a known line preset (null otherwise). */
export function getArrowPreset(shapeType: string): { begin: ArrowConfig; end: ArrowConfig } | null {
  return ARROW_PRESETS[shapeType] || null;
}

/**
 * Resolve the begin/end arrow heads for a line that is about to be drawn.
 *
 * - `line`           → no heads at all
 * - `line-arrow`     → remembers the last used arrow style (PowerPoint behaviour)
 * - concrete presets → their fixed configuration
 */
export function resolveArrowConfig(
  shapeType: string,
  defaults: { beginArrow: ArrowConfig; endArrow: ArrowConfig }
): { begin: ArrowConfig; end: ArrowConfig } {
  if (shapeType === 'line') return { begin: { ...NO_ARROW }, end: { ...NO_ARROW } };
  if (shapeType === 'line-arrow') {
    return { begin: { ...defaults.beginArrow }, end: { ...defaults.endArrow } };
  }
  const preset = getArrowPreset(shapeType);
  return preset
    ? { begin: { ...preset.begin }, end: { ...preset.end } }
    : { begin: { ...NO_ARROW }, end: { ...NO_ARROW } };
}

/** Translate the UI line cap value into a valid SVG `stroke-linecap` value. */
export function lineCapToSvg(cap?: LineCap): 'butt' | 'round' | 'square' {
  if (cap === 'flat') return 'butt';
  if (cap === 'square') return 'square';
  return 'round';
}

/**
 * Whether the arrow head covers the shaft (the shaft must be shortened).
 * An open V head is drawn on top of the line tip, so the shaft keeps its length.
 */
export function arrowConsumesShaft(type: ArrowType): boolean {
  return type !== 'none' && type !== 'open';
}

/**
 * Get arrow size multipliers based on size setting
 * Returns [widthMultiplier, lengthMultiplier]
 */
export function getArrowSizeMultipliers(size: ArrowSize): [number, number] {
  switch (size) {
    case 'small':
      return [0.7, 0.7];
    case 'medium':
      return [1.0, 1.0];
    case 'large':
      return [1.5, 1.5];
  }
}

/**
 * Calculate arrow head dimensions based on stroke width and size
 * Returns the length of the arrow head (how much to shorten the shaft)
 */
export function getArrowHeadLength(
  strokeWidth: number,
  arrowType: ArrowType,
  arrowSize: ArrowSize
): number {
  if (arrowType === 'none') return 0;
  
  const [widthMult, lengthMult] = getArrowSizeMultipliers(arrowSize);
  const baseLength = strokeWidth * 3.5 * lengthMult;
  
  switch (arrowType) {
    case 'triangle':
    case 'stealth':
      return baseLength;
    case 'open':
      return baseLength * 0.8;
    case 'oval':
      return strokeWidth * 2.5 * lengthMult;
    case 'diamond':
      return strokeWidth * 4 * lengthMult;
    default:
      return 0;
  }
}

/** Line direction in degrees (atan2), start → end. */
export function getLineAngleDeg(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): number {
  return Math.atan2(endY - startY, endX - startX) * (180 / Math.PI);
}

/**
 * SVG `rotate()` for a right-pointing head from `getArrowHeadPath`.
 * Begin must face opposite the line so the tip points away from the shaft.
 */
export function getArrowHeadRotateDeg(lineAngleDeg: number, at: 'begin' | 'end'): number {
  return at === 'begin' ? lineAngleDeg + 180 : lineAngleDeg;
}

/** Local start/end of a straight arrow line (points, else width-based fallback). */
export function resolveArrowLinePoints(
  width: number,
  height: number,
  points?: Point[]
): { start: Point; end: Point } {
  const hasPoints = !!(points && points.length >= 2);
  return {
    start: hasPoints ? points![0] : { x: 0, y: height / 2 },
    end: hasPoints ? points![points!.length - 1] : { x: width, y: height / 2 },
  };
}

/**
 * Generate SVG path for arrow head
 * Arrow is centered at origin, pointing right (+x direction)
 * Caller should translate/rotate to correct position
 */
export function getArrowHeadPath(
  strokeWidth: number,
  arrowType: ArrowType,
  arrowSize: ArrowSize
): string {
  if (arrowType === 'none') return '';
  
  const [widthMult, lengthMult] = getArrowSizeMultipliers(arrowSize);
  const width = strokeWidth * 2.5 * widthMult;
  const length = getArrowHeadLength(strokeWidth, arrowType, arrowSize);
  
  switch (arrowType) {
    case 'triangle':
      // Filled triangle
      return `M 0 0 L ${-length} ${-width / 2} L ${-length} ${width / 2} Z`;
    
    case 'stealth':
      // Stealth (narrow triangle)
      return `M 0 0 L ${-length} ${-width / 3} L ${-length * 0.7} 0 L ${-length} ${width / 3} Z`;
    
    case 'open':
      // Open V shape
      return `M ${-length} ${-width / 2} L 0 0 L ${-length} ${width / 2}`;
    
    case 'oval':
      // Circle/oval
      const r = length / 2;
      return `M ${-r} 0 a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`;
    
    case 'diamond':
      // Diamond shape
      const halfLen = length / 2;
      return `M 0 0 L ${-halfLen} ${-width / 2} L ${-length} 0 L ${-halfLen} ${width / 2} Z`;
    
    default:
      return '';
  }
}

/**
 * Check if arrow head should be filled
 */
export function isArrowHeadFilled(arrowType: ArrowType): boolean {
  return arrowType !== 'open' && arrowType !== 'none';
}

/**
 * Calculate shortened line endpoints to prevent shaft from poking through arrow heads
 */
export function getShortenedLineEndpoints(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  strokeWidth: number,
  beginArrowType: ArrowType,
  beginArrowSize: ArrowSize,
  endArrowType: ArrowType,
  endArrowSize: ArrowSize
): { startX: number; startY: number; endX: number; endY: number } {
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.hypot(dx, dy);
  
  if (length < 1) {
    return { startX, startY, endX, endY };
  }
  
  const unitX = dx / length;
  const unitY = dy / length;
  
  // Shorten from start
  const beginLength = arrowConsumesShaft(beginArrowType)
    ? getArrowHeadLength(strokeWidth, beginArrowType, beginArrowSize)
    : 0;
  const newStartX = startX + unitX * beginLength;
  const newStartY = startY + unitY * beginLength;

  // Shorten from end
  const endLength = arrowConsumesShaft(endArrowType)
    ? getArrowHeadLength(strokeWidth, endArrowType, endArrowSize)
    : 0;
  const newEndX = endX - unitX * endLength;
  const newEndY = endY - unitY * endLength;
  
  return {
    startX: newStartX,
    startY: newStartY,
    endX: newEndX,
    endY: newEndY
  };
}

/**
 * Snap angle to 15 degree increments (for Shift key constraint)
 */
export function snapAngleTo15Degrees(angle: number): number {
  const snapAngle = 15 * (Math.PI / 180);
  return Math.round(angle / snapAngle) * snapAngle;
}

/**
 * Calculate constrained end point when Shift is held (snap to 15/45 degree angles)
 */
export function getConstrainedPoint(startX: number, startY: number, endX: number, endY: number): Point {
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const snappedAngle = snapAngleTo15Degrees(angle);
  
  return {
    x: startX + length * Math.cos(snappedAngle),
    y: startY + length * Math.sin(snappedAngle)
  };
}
