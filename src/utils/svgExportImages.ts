import { CanvasElement, ImageElement, Layer } from '../types';

/** Images that assembleSvgString will actually draw (visible layer + visible element). */
export function getExportVisibleImageElements(layers: Layer[], elements: CanvasElement[]): ImageElement[] {
  const visibleLayerIds = new Set(layers.filter((l) => l.visible).map((l) => l.id));
  return elements.filter(
    (el): el is ImageElement =>
      el.type === 'image' && el.visible !== false && visibleLayerIds.has(el.layerId)
  );
}
