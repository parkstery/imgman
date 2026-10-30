/**
 * Color math + color-wheel data for the toolbar color picker popover.
 * HSV drives the saturation/value square and hue slider; RGB/HEX/HSL are
 * the editable text formats.
 */

export type RGB = [number, number, number];
export type HSV = [number, number, number]; // h 0–360, s 0–1, v 0–1

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function hsvToRgb(h: number, s: number, v: number): RGB {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return [f(5), f(3), f(1)];
}

function hueOf(r: number, g: number, b: number, max: number, delta: number): number {
  if (!delta) return 0;
  const h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (h * 60 + 360) % 360;
}

export function rgbToHsv(r: number, g: number, b: number): HSV {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const delta = max - Math.min(rn, gn, bn);
  return [hueOf(rn, gn, bn, max, delta), max ? delta / max : 0, max];
}

/** HSL as whole numbers: h 0–360, s/l 0–100. */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;
  const s = delta ? delta / (1 - Math.abs(2 * l - 1)) : 0;
  return [Math.round(hueOf(rn, gn, bn, max, delta)) % 360, Math.round(s * 100), Math.round(l * 100)];
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return (ln - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
  };
  return [f(0), f(8), f(4)];
}

export function rgbToHex([r, g, b]: RGB): string {
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/** Accepts #RRGGBB / RRGGBB / #RGB; returns null for anything else. */
export function parseHex(input: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(hex, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/**
 * HSV for a new color, keeping the previous hue (and saturation) where the
 * color itself has none — so dragging to black/white doesn't snap the hue
 * slider back to red.
 */
export function hsvFromRgbKeepingHue(rgb: RGB, prev: HSV): HSV {
  const [h, s, v] = rgbToHsv(...rgb);
  if (v === 0) return [prev[0], prev[1], 0];
  if (s === 0) return [prev[0], 0, v];
  return [h, s, v];
}

// ---- Color wheel: 12 hues × 7 tint rings (outer = pure hue → inner ≈ 80% white) ----

/** Clockwise from 12 o'clock: red, rose, magenta, violet, blue, azure, cyan, spring, green, chartreuse, yellow, orange. */
export const WHEEL_HUES = [0, 330, 300, 270, 240, 210, 180, 150, 120, 90, 60, 30];
export const WHEEL_RINGS = 7;
export const WHEEL_OUTER_R = 94;
export const WHEEL_INNER_R = 15;
const MAX_TINT = 0.8;

export interface WheelCell {
  hex: string;
  d: string;
}

function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [+(r * Math.cos(a)).toFixed(3), +(r * Math.sin(a)).toFixed(3)];
}

function ringSegmentPath(r0: number, r1: number, a0: number, a1: number): string {
  const [x0, y0] = polar(r1, a0);
  const [x1, y1] = polar(r1, a1);
  const [x2, y2] = polar(r0, a1);
  const [x3, y3] = polar(r0, a0);
  return `M${x0} ${y0}A${r1} ${r1} 0 0 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 0 0 ${x3} ${y3}Z`;
}

export function wheelColor(hue: number, ring: number): string {
  const t = (ring / (WHEEL_RINGS - 1)) * MAX_TINT;
  const base = hsvToRgb(hue, 1, 1);
  return rgbToHex(base.map((v) => v + (255 - v) * t) as RGB);
}

/** SVG cells centred on (0,0), red wedge centred at the top. */
export const COLOR_WHEEL_CELLS: WheelCell[] = (() => {
  const step = (WHEEL_OUTER_R - WHEEL_INNER_R) / WHEEL_RINGS;
  const cells: WheelCell[] = [];
  WHEEL_HUES.forEach((hue, i) => {
    const a0 = i * 30 - 15;
    for (let ring = 0; ring < WHEEL_RINGS; ring++) {
      const r1 = WHEEL_OUTER_R - ring * step;
      cells.push({ hex: wheelColor(hue, ring), d: ringSegmentPath(r1 - step, r1, a0, a0 + 30) });
    }
  });
  return cells;
})();
