/**
 * 배경 제거 핵심 알고리즘 검증 (스크린샷/단색 배경)
 * 실행: npm run verify:bg
 */
import {
  clearBackgroundColorInPlace,
  parseHexColor,
  rgbToHex,
  type RgbColor,
} from '../src/utils/imageEdit';

type RGBA = [number, number, number, number];

function makeImage(
  width: number,
  height: number,
  fill: RGBA,
  draw?: (x: number, y: number) => RGBA | null
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = (draw && draw(x, y)) || fill;
      const i = (y * width + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = c[3];
    }
  }
  return data;
}

function alphaAt(px: Uint8ClampedArray, w: number, x: number, y: number): number {
  return px[(y * w + x) * 4 + 3];
}

function sameColor(a: RgbColor | null, b: RgbColor): boolean {
  return !!a && a.r === b.r && a.g === b.g && a.b === b.b;
}

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}`, detail ?? '');
  }
}

console.log('1) 흰 배경 + 빨간 객체 → 배경만 제거');
{
  const w = 10;
  const h = 10;
  const px = makeImage(w, h, [255, 255, 255, 255], (x, y) =>
    x >= 3 && x < 7 && y >= 3 && y < 7 ? [255, 0, 0, 255] : null
  );
  const r = clearBackgroundColorInPlace(px, w, h, 30);
  check('제거 84픽셀', r.removed === 84, r);
  check('abort 없음', r.aborted === null, r.aborted);
  check('감지색 흰색', sameColor(r.seedColor, { r: 255, g: 255, b: 255 }), r.seedColor);
  check('배경 alpha 0', alphaAt(px, w, 0, 0) === 0);
  check('객체 alpha 255', alphaAt(px, w, 5, 5) === 255);
}

console.log('2) 객체 내부의 같은 색 디테일은 보존 (연결성)');
{
  const w = 12;
  const h = 12;
  const px = makeImage(w, h, [255, 255, 255, 255], (x, y) => {
    if (x >= 2 && x < 10 && y >= 2 && y < 10) {
      if (x >= 5 && x < 7 && y >= 5 && y < 7) return [255, 255, 255, 255];
      return [255, 0, 0, 255];
    }
    return null;
  });
  const r = clearBackgroundColorInPlace(px, w, h, 30);
  check('abort 없음', r.aborted === null, r.aborted);
  check('배경 alpha 0', alphaAt(px, w, 0, 0) === 0);
  check('객체 내부 흰색 alpha 255', alphaAt(px, w, 5, 5) === 255);
  check('객체 빨강 alpha 255', alphaAt(px, w, 3, 5) === 255);
}

console.log('3) 배경색 직접 지정 → 해당 색만 제거');
{
  const w = 10;
  const h = 10;
  const px = makeImage(w, h, [255, 255, 255, 255], (x, y) =>
    x < 4 && y >= 2 && y < 8 ? [0, 0, 255, 255] : null
  );
  const r = clearBackgroundColorInPlace(px, w, h, 20, {
    seedColor: { r: 0, g: 0, b: 255 },
  });
  check('파란 영역 제거', r.removed === 24, r);
  check('abort 없음', r.aborted === null, r.aborted);
  check('파랑 alpha 0', alphaAt(px, w, 0, 4) === 0);
  check('흰색 alpha 255', alphaAt(px, w, 8, 4) === 255);
}

console.log('4) 가장자리가 이미 투명하면 중단');
{
  const px = makeImage(8, 8, [0, 0, 0, 0]);
  const r = clearBackgroundColorInPlace(px, 8, 8, 30);
  check('border-transparent', r.aborted === 'border-transparent', r.aborted);
  check('제거 0픽셀', r.removed === 0, r.removed);
}

console.log('5) 지정색이 없으면 no-match');
{
  const px = makeImage(8, 8, [255, 255, 255, 255]);
  const r = clearBackgroundColorInPlace(px, 8, 8, 10, {
    seedColor: { r: 255, g: 0, b: 0 },
  });
  check('no-match', r.aborted === 'no-match', r.aborted);
}

console.log('6) 이미지 전체가 지워지면 안전 중단');
{
  const px = makeImage(8, 8, [255, 255, 255, 255]);
  const r = clearBackgroundColorInPlace(px, 8, 8, 30);
  check('flood-everything', r.aborted === 'flood-everything', r.aborted);
}

console.log('7) 가장자리 페더링');
{
  const w = 20;
  const h = 20;
  const px = makeImage(w, h, [255, 255, 255, 255], (x, y) =>
    x >= 8 && x <= 10 && y >= 8 && y <= 10 ? [225, 225, 225, 255] : null
  );
  const r = clearBackgroundColorInPlace(px, w, h, 10, { feather: 50 });
  check('abort 없음', r.aborted === null, r.aborted);
  const edgeAlpha = alphaAt(px, w, 8, 8);
  const centerAlpha = alphaAt(px, w, 9, 9);
  check('경계 alpha가 0과 255 사이', edgeAlpha > 0 && edgeAlpha < 255, edgeAlpha);
  check('중앙 alpha는 255', centerAlpha === 255, centerAlpha);
}

console.log('8) 페더 0% → 경계도 선명하게 유지');
{
  const w = 20;
  const h = 20;
  const px = makeImage(w, h, [255, 255, 255, 255], (x, y) =>
    x >= 8 && x <= 10 && y >= 8 && y <= 10 ? [225, 225, 225, 255] : null
  );
  const r = clearBackgroundColorInPlace(px, w, h, 10, { feather: 0 });
  check('abort 없음', r.aborted === null, r.aborted);
  check('경계 alpha 255', alphaAt(px, w, 8, 8) === 255, alphaAt(px, w, 8, 8));
}

console.log('9) 피사체가 가장자리에 닿아도 지배색을 배경으로 선택');
{
  const w = 10;
  const h = 10;
  const px = makeImage(w, h, [255, 255, 255, 255], (x, y) =>
    x === 0 && y >= 4 && y <= 6 ? [255, 0, 0, 255] : null
  );
  const r = clearBackgroundColorInPlace(px, w, h, 20);
  check('감지색 흰색', sameColor(r.seedColor, { r: 255, g: 255, b: 255 }), r.seedColor);
  check('가장자리 빨강 alpha 255', alphaAt(px, w, 0, 5) === 255);
  check('일반 배경 alpha 0', alphaAt(px, w, 5, 5) === 0);
}

console.log('10) 큰 스크린샷 속 작은 아이콘도 보존');
{
  const w = 100;
  const h = 100;
  const px = makeImage(w, h, [255, 255, 255, 255], (x, y) =>
    x >= 48 && x < 52 && y >= 48 && y < 52 ? [220, 30, 90, 255] : null
  );
  const r = clearBackgroundColorInPlace(px, w, h, 30);
  check('abort 없음', r.aborted === null, r.aborted);
  check('작은 아이콘 alpha 255', alphaAt(px, w, 49, 49) === 255);
  check('배경 alpha 0', alphaAt(px, w, 0, 0) === 0);
}

console.log('11) 색상 파싱/직렬화');
{
  check('#abc 확장', sameColor(parseHexColor('#abc'), { r: 170, g: 187, b: 204 }));
  check('#12AB34 파싱', sameColor(parseHexColor('#12AB34'), { r: 18, g: 171, b: 52 }));
  check('잘못된 값 null', parseHexColor('not-a-color') === null);
  check('rgbToHex', rgbToHex({ r: 18, g: 171, b: 52 }) === '#12AB34');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
