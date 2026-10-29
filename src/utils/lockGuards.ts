import { CanvasElement, Layer } from '../types';

export function findLayer(layers: Layer[], layerId: string): Layer | undefined {
  return layers.find((layer) => layer.id === layerId);
}

export function isLayerLocked(layers: Layer[], layerId: string): boolean {
  return !!findLayer(layers, layerId)?.locked;
}

/** True when the element itself or its owning layer is locked. */
export function isElementLocked(el: CanvasElement, layers: Layer[]): boolean {
  if (el.locked) return true;
  return isLayerLocked(layers, el.layerId);
}

/** Selection is allowed; mutation is not. */
export function canEditElement(el: CanvasElement, layers: Layer[]): boolean {
  return !isElementLocked(el, layers);
}

export function canEditLayer(layer: Layer | undefined): boolean {
  return !!layer && !layer.locked;
}

export function layerHasLockedElements(elements: CanvasElement[], layerId: string): boolean {
  return elements.some((el) => el.layerId === layerId && !!el.locked);
}

export function canDeleteLayer(
  layer: Layer | undefined,
  layerCount: number,
  elements?: CanvasElement[]
): boolean {
  if (!layer || layerCount <= 1) return false;
  if (layer.locked) return false;
  if (elements && layerHasLockedElements(elements, layer.id)) return false;
  return true;
}

/** Lock/unlock of the `locked` flag only, with every other field unchanged. */
export function isLockFlagToggle(prev: CanvasElement, next: CanvasElement): boolean {
  if (prev.id !== next.id) return false;
  if (!!prev.locked === !!next.locked) return false;
  const prevRest = { ...prev, locked: undefined };
  const nextRest = { ...next, locked: undefined };
  return JSON.stringify(prevRest) === JSON.stringify(nextRest);
}

/**
 * Explicit element lock/unlock is permitted. Layer lock still blocks other edits.
 * Layer unlock itself is a layer mutation, not an element mutation.
 */
export function canApplyElementMutation(
  prev: CanvasElement,
  next: CanvasElement,
  layers: Layer[]
): boolean {
  if (isLockFlagToggle(prev, next) && !isLayerLocked(layers, prev.layerId)) {
    return true;
  }
  return canEditElement(prev, layers);
}

export function filterEditableElements(
  candidates: CanvasElement[],
  layers: Layer[]
): CanvasElement[] {
  return candidates.filter((el) => canEditElement(el, layers));
}

/** Canvas clear keeps locked objects (and objects on locked layers). */
export function elementsRemainingAfterClear(
  elements: CanvasElement[],
  layers: Layer[]
): CanvasElement[] {
  return elements.filter((el) => isElementLocked(el, layers));
}
