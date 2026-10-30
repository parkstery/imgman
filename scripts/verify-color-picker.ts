/**
 * Checks for the toolbar color picker math + color wheel (2026-10-30).
 *
 * Run: node scripts/run-node-esm.mjs scripts/verify-color-picker.ts
 */
import {
  COLOR_WHEEL_CELLS,
  WHEEL_HUES,
  WHEEL_RINGS,
  hslToRgb,
  hsvFromRgbKeepingHue,
  hsvToRgb,
  parseHex,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
  wheelColor,
} from '../src/utils/colorPicker';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('hex parsing');
check('#RRGGBB', JSON.stringify(parseHex('#4472C4')) === '[68,114,196]');
check('no hash + lowercase', JSON.stringify(parseHex('ff8000')) === '[255,128,0]');
check('#RGB shorthand', JSON.stringify(parseHex('#f80')) === '[255,136,0]');
check('rejects garbage', parseHex('#12345') === null && parseHex('red') === null && parseHex('') === null);
check('rgbToHex clamps + rounds', rgbToHex([300, -5, 127.6]) === '#FF0080');

console.log('round trips');
const samples = ['#000000', '#FFFFFF', '#4472C4', '#ED7D31', '#7F7F7F', '#00A2E8', '#B366FF', '#123456'];
for (const hex of samples) {
  const rgb = parseHex(hex)!;
  const [h, s, v] = rgbToHsv(...rgb);
  check(`hsv ${hex}`, rgbToHex(hsvToRgb(h, s, v)) === hex, rgbToHex(hsvToRgb(h, s, v)));
  const [hh, ss, ll] = rgbToHsl(...rgb);
  const back = hslToRgb(hh, ss, ll);
  const err = Math.max(...back.map((c, i) => Math.abs(c - rgb[i])));
  check(`hsl ${hex} (±3)`, err <= 3, `max channel error ${err.toFixed(1)}`);
}
check('hsl red', JSON.stringify(rgbToHsl(255, 0, 0)) === '[0,100,50]');
check('hsl hue 360 wraps', rgbToHex(hslToRgb(360, 100, 50)) === '#FF0000');

console.log('hue kept on achromatic colors');
check('black keeps hue + saturation', JSON.stringify(hsvFromRgbKeepingHue([0, 0, 0], [210, 0.6, 0.8])) === '[210,0.6,0]');
const white = hsvFromRgbKeepingHue([255, 255, 255], [120, 0.5, 0.5]);
check('white keeps hue, drops saturation', white[0] === 120 && white[1] === 0 && white[2] === 1);
check('chromatic color takes its own hue', Math.round(hsvFromRgbKeepingHue([0, 0, 255], [10, 1, 1])[0]) === 240);

console.log('color wheel');
check('12 hues × 7 rings', COLOR_WHEEL_CELLS.length === WHEEL_HUES.length * WHEEL_RINGS && COLOR_WHEEL_CELLS.length === 84);
check('top wedge outer ring is pure red', COLOR_WHEEL_CELLS[0].hex === '#FF0000');
check('order clockwise: rose after red', wheelColor(WHEEL_HUES[1], 0) === '#FF0080');
check('cyan at the bottom (index 6)', wheelColor(WHEEL_HUES[6], 0) === '#00FFFF');
check('outer ring = pure hues', WHEEL_HUES.every((h) => rgbToHex(hsvToRgb(h, 1, 1)) === wheelColor(h, 0)));
const innerRed = parseHex(wheelColor(0, WHEEL_RINGS - 1))!;
check('inner ring ≈ 80% white tint', innerRed[0] === 255 && innerRed[1] === 204 && innerRed[2] === 204, rgbToHex(innerRed));
check('all cell colors distinct', new Set(COLOR_WHEEL_CELLS.map((c) => c.hex)).size === COLOR_WHEEL_CELLS.length);
check('tints get lighter inward', WHEEL_HUES.every((h) => {
  const sums = Array.from({ length: WHEEL_RINGS }, (_, r) => parseHex(wheelColor(h, r))!.reduce((a, b) => a + b, 0));
  return sums.every((v, i) => i === 0 || v > sums[i - 1]);
}));
check('cell paths are closed arcs', COLOR_WHEEL_CELLS.every((c) => /^M.*A.*L.*A.*Z$/.test(c.d) && !c.d.includes('NaN')));

console.log(failures === 0 ? '\nall color picker checks passed' : `\n${failures} check(s) FAILED`);
if (failures > 0) process.exit(1);
