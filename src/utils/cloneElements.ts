import { BrushStrokeElement, CanvasElement } from '../types';

export interface CloneElementsOptions {
  offsetX?: number;
  offsetY?: number;
  layerId?: string;
  nameSuffix?: string;
  stamp?: string;
  idFactory?: (el: CanvasElement, index: number) => string;
  groupIdFactory?: (oldGroupId: string, indexInMap: number) => string;
}

function translateBrushPoints(
  el: CanvasElement,
  offsetX: number,
  offsetY: number
): CanvasElement {
  if (el.type !== 'brush' || !el.points || (offsetX === 0 && offsetY === 0)) {
    return el;
  }
  const next = el as BrushStrokeElement;
  return {
    ...next,
    points: next.points.map((p) => ({
      x: p.x + offsetX,
      y: p.y + offsetY,
    })),
  };
}

/**
 * Remap group IDs for one clone batch. Members that shared a group stay
 * grouped together; the new IDs are distinct from the originals.
 */
export function remapGroupIds(
  elements: CanvasElement[],
  salt: string,
  groupIdFactory?: (oldGroupId: string, indexInMap: number) => string
): CanvasElement[] {
  const groupMap = new Map<string, string>();
  return elements.map((el) => {
    if (!el.groupId) return el;
    if (!groupMap.has(el.groupId)) {
      const indexInMap = groupMap.size;
      groupMap.set(
        el.groupId,
        groupIdFactory
          ? groupIdFactory(el.groupId, indexInMap)
          : `group-${salt}-${indexInMap}`
      );
    }
    return { ...el, groupId: groupMap.get(el.groupId) };
  });
}

/**
 * Clone a batch of elements: new IDs, remapped group IDs (relationships kept
 * within the batch), optional layer move, and absolute brush-point translation.
 */
export function cloneElements(
  source: CanvasElement[],
  options: CloneElementsOptions = {}
): CanvasElement[] {
  const offsetX = options.offsetX ?? 0;
  const offsetY = options.offsetY ?? 0;
  const stamp =
    options.stamp ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const withNewIds = source.map((el, i) => {
    const copy: CanvasElement = {
      ...el,
      id: options.idFactory ? options.idFactory(el, i) : `${el.type}-${stamp}-${i}`,
      x: el.x + offsetX,
      y: el.y + offsetY,
      layerId: options.layerId ?? el.layerId,
      name: options.nameSuffix
        ? `${el.name || el.type}${options.nameSuffix}`
        : el.name,
    };
    return translateBrushPoints(copy, offsetX, offsetY);
  });

  return remapGroupIds(withNewIds, stamp, options.groupIdFactory);
}

/**
 * Split a flat radial-copy list (count * sources.length) into per-instance
 * batches and give each instance its own group IDs.
 */
export function remapRadialInstanceGroups(
  copies: CanvasElement[],
  sourceCount: number,
  salt: string
): CanvasElement[] {
  if (sourceCount <= 0 || copies.length === 0) return copies;
  const result: CanvasElement[] = [];
  for (let i = 0; i < copies.length; i += sourceCount) {
    const batch = copies.slice(i, i + sourceCount);
    result.push(...remapGroupIds(batch, `${salt}-${i / sourceCount}`));
  }
  return result;
}
