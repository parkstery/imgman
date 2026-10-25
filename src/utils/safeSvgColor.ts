const NAMED_HEX_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
};

function isHexDigit(ch: string): boolean {
  return /[0-9a-fA-F]/.test(ch);
}

function expandHex3(hex: string): string {
  return [...hex].map((h) => h + h).join('').toLowerCase();
}

function hasBreakoutChars(c: string): boolean {
  return /[<>"';]/.test(c);
}

function tryParseRgbRgba(c: string): string | null {
  const rgbMatch = c.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)$/i
  );
  if (!rgbMatch) return null;
  const r = Number(rgbMatch[1]);
  const g = Number(rgbMatch[2]);
  const b = Number(rgbMatch[3]);
  if (r > 255 || g > 255 || b > 255) return null;
  if (rgbMatch[4] !== undefined) {
    const a = Number(rgbMatch[4]);
    if (Number.isNaN(a) || a < 0 || a > 1) return null;
    return `rgba(${r},${g},${b},${a})`;
  }
  return `rgb(${r},${g},${b})`;
}

/**
 * Safe color for SVG presentation attributes (stroke/fill in quoted attributes).
 * Rejects breakout payloads; unknown input → #000000.
 */
export function serializeSafeSvgColor(input: string | undefined | null): string {
  if (input == null) return '#000000';
  const c = String(input).trim();
  if (!c) return '#000000';

  if (hasBreakoutChars(c)) return '#000000';
  if (/url\s*\(/i.test(c)) return '#000000';

  const rgbParsed = tryParseRgbRgba(c);
  if (rgbParsed) return rgbParsed;

  if (c.startsWith('#')) {
    const hex = c.slice(1);
    if (hex.length === 3 && [...hex].every(isHexDigit)) {
      return '#' + expandHex3(hex);
    }
    if (hex.length === 6 && [...hex].every(isHexDigit)) {
      return '#' + hex.toLowerCase();
    }
    if (hex.length === 8 && [...hex].every(isHexDigit)) {
      return '#' + hex.slice(0, 6).toLowerCase();
    }
    return '#000000';
  }

  const lower = c.toLowerCase();
  if (lower === 'transparent') return 'transparent';
  if (lower === 'none') return 'none';

  const named = NAMED_HEX_COLORS[lower];
  if (named) return named;

  if (/[()]/.test(c)) return '#000000';

  return '#000000';
}
