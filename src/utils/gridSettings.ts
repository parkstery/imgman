/** Canvas grid limits and helpers shared by the header, properties panel and canvas overlay. */

export const GRID_SIZE_MIN = 2;
export const GRID_SIZE_MAX = 500;
/** A small dot marks every Nth grid intersection. */
export const GRID_MAJOR_EVERY = 5;

export function clampGridSize(value: number): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(GRID_SIZE_MAX, Math.max(GRID_SIZE_MIN, Math.round(value)));
}

/** True for a dark canvas paper (or transparent, which shows a dark checker). */
export function isDarkCanvasBackground(color: string | undefined): boolean {
  if (!color || color === 'transparent') return true;
  const hex = color.trim().replace(/^#/, '');
  const full =
    hex.length === 3 || hex.length === 4
      ? hex
          .slice(0, 3)
          .split('')
          .map((c) => c + c)
          .join('')
      : hex.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(full)) return false;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}
