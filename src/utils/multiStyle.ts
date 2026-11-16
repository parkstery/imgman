import type { CanvasElement, GradientSettings, ShapeElement } from '../types';
import { isLineShapeType } from './stylePrefs';

/** Deep-compare gradients the same way the style memory does. */
function sameGradient(a?: GradientSettings, b?: GradientSettings): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function copyGradient(g?: GradientSettings): GradientSettings | undefined {
  return g ? { ...g } : undefined;
}

/**
 * Mirror a single PropertiesPanel color edit onto the other selected elements.
 *
 * `before` and `updated` are the same element before/after the edit; `others`
 * are the remaining editable members of the selection. Returns the elements
 * that need to change, using new objects and never mutating the inputs.
 * An empty result means the edit changed no color property.
 */
export function propagateColorChange(
  before: CanvasElement,
  updated: CanvasElement,
  others: CanvasElement[]
): CanvasElement[] {
  const shapeSource =
    before.type === 'shape' && updated.type === 'shape' ? { before, updated } : null;
  const imageSource =
    before.type === 'image' && updated.type === 'image' ? { before, updated } : null;

  const fillChanged = !!shapeSource && shapeSource.before.fill !== shapeSource.updated.fill;
  const gradientChanged = !!shapeSource && !sameGradient(shapeSource.before.gradient, shapeSource.updated.gradient);
  const strokeChanged = !!shapeSource && shapeSource.before.stroke !== shapeSource.updated.stroke;

  const beforeColor =
    before.type === 'text' || before.type === 'brush' ? before.color : null;
  const updatedColor =
    updated.type === 'text' || updated.type === 'brush' ? updated.color : null;
  const textColorChanged =
    beforeColor !== null &&
    updatedColor !== null &&
    before.type === updated.type &&
    beforeColor !== updatedColor;

  const borderColorChanged =
    !!imageSource && imageSource.before.borderColor !== imageSource.updated.borderColor;

  if (!fillChanged && !gradientChanged && !strokeChanged && !textColorChanged && !borderColorChanged) {
    return [];
  }

  const fillColor = shapeSource ? shapeSource.updated.fill : 'none';
  const strokeColor = shapeSource ? shapeSource.updated.stroke : 'none';
  const result: CanvasElement[] = [];

  for (const other of others) {
    if (other.type === 'shape') {
      let next: ShapeElement = other;

      if (shapeSource) {
        // A fill edit becomes the fill of closed shapes, or the outline of lines.
        if (fillChanged) {
          if (isLineShapeType(other.shapeType)) {
            if (fillColor !== 'none') next = { ...next, stroke: fillColor };
          } else {
            next = { ...next, fill: fillColor };
            if (gradientChanged) {
              next = { ...next, gradient: copyGradient(shapeSource.updated.gradient) };
            } else if (fillColor !== 'none' && next.gradient) {
              next = {
                ...next,
                gradient: { ...next.gradient, enabled: false, startColor: fillColor },
              };
            }
          }
        }

        // A gradient edit copies the whole gradient (and its fill) to closed shapes.
        if (gradientChanged && !isLineShapeType(other.shapeType)) {
          next = {
            ...next,
            fill: shapeSource.updated.fill,
            gradient: copyGradient(shapeSource.updated.gradient),
          };
        }

        if (strokeChanged) {
          next = { ...next, stroke: strokeColor };
        }
      }

      // Text/brush color edit: lines (and fill-less shapes) take it as outline.
      if (textColorChanged && updatedColor !== null) {
        if (isLineShapeType(other.shapeType) || other.fill === 'none') {
          next = { ...next, stroke: updatedColor };
        } else {
          next = {
            ...next,
            fill: updatedColor,
            gradient: next.gradient
              ? { ...next.gradient, enabled: false, startColor: updatedColor }
              : undefined,
          };
        }
      }

      if (JSON.stringify(next) !== JSON.stringify(other)) result.push(next);
      continue;
    }

    if (other.type === 'text' || other.type === 'brush') {
      let color: string | null = null;
      // A closed shape's fill edit recolors text/brush unless it is "none".
      if (fillChanged && fillColor !== 'none') color = fillColor;
      // A line's stroke is its main color, so text/brush follow it too.
      if (
        strokeChanged &&
        shapeSource &&
        isLineShapeType(shapeSource.before.shapeType) &&
        strokeColor !== 'none'
      ) {
        color = strokeColor;
      }
      if (textColorChanged) color = updatedColor;
      if (color !== null && color !== other.color) result.push({ ...other, color });
      continue;
    }

    if (other.type === 'image' && imageSource && borderColorChanged) {
      if (other.borderColor !== imageSource.updated.borderColor) {
        result.push({ ...other, borderColor: imageSource.updated.borderColor });
      }
    }
  }

  return result;
}
