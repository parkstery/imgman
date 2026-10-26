import { ArrowType, ArrowSize, Point } from '../types';

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
  const beginLength = getArrowHeadLength(strokeWidth, beginArrowType, beginArrowSize);
  const newStartX = startX + unitX * beginLength;
  const newStartY = startY + unitY * beginLength;
  
  // Shorten from end
  const endLength = getArrowHeadLength(strokeWidth, endArrowType, endArrowSize);
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
