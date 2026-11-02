import type { ShapeType } from '../types';

/** Shapes offered in the toolbar's shape gallery (도형 모음). */
export const GALLERY_SHAPE_TYPES: readonly ShapeType[] = [
  'rect',
  'rounded-rect',
  'ellipse',
  'triangle',
  'diamond',
  'star',
  'arrow-right',
  'arrow-bidirectional',
  'speech-bubble',
  'heart',
  'hexagon',
  'line',
  'line-arrow',
  'polyline',
  'arc',
];

export const DEFAULT_GALLERY_SHAPE: ShapeType = 'rounded-rect';
const GALLERY_SHAPE_KEY = 'imgman.galleryShape';

/** Last shape picked from the gallery (per-browser convenience; falls back to the default). */
export function loadGalleryShape(): ShapeType {
  try {
    const raw = localStorage.getItem(GALLERY_SHAPE_KEY);
    if (raw && (GALLERY_SHAPE_TYPES as readonly string[]).includes(raw)) return raw as ShapeType;
  } catch {
    // Storage blocked (private mode etc.) — use the default.
  }
  return DEFAULT_GALLERY_SHAPE;
}

export function saveGalleryShape(shape: ShapeType): void {
  try {
    localStorage.setItem(GALLERY_SHAPE_KEY, shape);
  } catch {
    // Ignore — memory still works for this session.
  }
}
