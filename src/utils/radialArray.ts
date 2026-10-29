import {
  BrushStrokeElement,
  CanvasElement,
  RadialToolState,
} from '../types';
import { getRotationPivot } from './elementGeometry';
import { remapGroupIds } from './cloneElements';

export { getRotationPivot } from './elementGeometry';

/** Normalize an angle in degrees into the [0, 360) range. */
export function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

/**
 * Angular distance between two consecutive copies.
 * - Full circle (360°): 360 / count, so the last copy never overlaps the first.
 * - Partial sweep: the copies are spread across both edges of the sweep.
 */
export function getRadialAngleStep(count: number, sweepAngle: number): number {
  const n = Math.max(2, Math.min(50, count));
  const sweep = Math.max(0, Math.min(360, sweepAngle));
  if (sweep >= 360) return 360 / n;
  return sweep / (n - 1);
}

/** Absolute angles (degrees) of every copy of the current arrangement. */
export function getRadialAngles(state: RadialToolState): number[] {
  const n = Math.max(2, Math.min(50, state.count));
  const step = getRadialAngleStep(n, state.sweepAngle);
  return Array.from({ length: n }, (_, i) => state.startAngle + step * i);
}

/**
 * Build the copies of `source` arranged on a circle.
 * Used for the live preview while the user drags, and reused when the
 * parameters in the properties panel change.
 */
export function buildRadialPreview(
  state: RadialToolState,
  layerId: string
): CanvasElement[] {
  const { center, sourceElement: source, sourceElements, radius } = state;
  const sources = sourceElements && sourceElements.length > 0 ? sourceElements : (source ? [source] : []);
  if (!center || sources.length === 0) return [];

  // Calculate the group bounding box center
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const src of sources) {
    minX = Math.min(minX, src.x);
    minY = Math.min(minY, src.y);
    maxX = Math.max(maxX, src.x + src.width);
    maxY = Math.max(maxY, src.y + src.height);
  }
  const groupCenterX = (minX + maxX) / 2;
  const groupCenterY = (minY + maxY) / 2;

  // Pre-calculate each source element's pivot and its offset from the group center
  const sourceOffsets = sources.map(src => {
    const pivot = getRotationPivot(src);
    return {
      element: src,
      // Offset from group center to this element's pivot point
      offsetX: src.x + pivot.x - groupCenterX,
      offsetY: src.y + pivot.y - groupCenterY,
      baseRotation: src.rotation || 0,
      pivot,
    };
  });

  return getRadialAngles(state).flatMap((theta, i) => {
    const rad = (theta * Math.PI) / 180;
    const px = center.x + radius * Math.cos(rad);
    const py = center.y + radius * Math.sin(rad);

    // Orientation of the copy:
    // - none      : every copy keeps the original angle
    // - tangential: copies follow the circle (first copy keeps its angle)
    // - radial    : copies point away from the center (sunburst)
    const groupRot =
      state.rotateMode === 'radial'
        ? theta
        : state.rotateMode === 'tangential'
        ? theta - state.startAngle
        : 0;

    const copies = sourceOffsets.map((offset, srcIndex) => {
      // Position this element's pivot at the circle radius
      const cr = Math.cos((groupRot * Math.PI) / 180);
      const sr = Math.sin((groupRot * Math.PI) / 180);
      const rotatedOffsetX = offset.offsetX * cr - offset.offsetY * sr;
      const rotatedOffsetY = offset.offsetX * sr + offset.offsetY * cr;
      const pivotX = px + rotatedOffsetX;
      const pivotY = py + rotatedOffsetY;

      // Element's top-left corner = pivot position - pivot offset
      const x = pivotX - offset.pivot.x;
      const y = pivotY - offset.pivot.y;

      // Element's own rotation + group rotation
      const rot = offset.baseRotation + groupRot;

      const src = offset.element;
      const copy = {
        ...(src as CanvasElement),
        id: `radial-preview-${i}-${srcIndex}`,
        layerId,
        name: `${src.name} (방사상 ${i + 1})`,
        x,
        y,
        width: src.width,
        height: src.height,
        rotation: rot,
        opacity: src.opacity ?? 1,
        flipH: src.flipH,
        flipV: src.flipV,
        shadow: src.shadow,
      } as CanvasElement;

      if (src.type === 'brush') {
        // Brush points are stored in absolute canvas coordinates.
        (copy as BrushStrokeElement).points = src.points.map((p) => ({
          x: p.x + (x - src.x),
          y: p.y + (y - src.y),
        }));
      }
      return copy;
    });
    return remapGroupIds(copies, `radial-${i}`);
  });
}