/**
 * 자동 자르기(Auto-Crop) 핵심 알고리즘 검증 스크립트
 * 실행: npx tsx scripts/verify-autocrop.ts
 */
import { findTrimBounds, padRect, TrimOptions } from '../src/utils/autoCrop';

type RGBA = [number, number, number, number];

function makeImage(
  width: number,
  height: number,
  fill: RGBA,
  draw?: (x: number, y: number) => RGBA | null
): ImageData {
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
  return { width, height, data, colorSpace: 'srgb' } as unknown as ImageData;
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

function rectIs(
  actual: { x: number; y: number; w: number; h: number } | undefined,
  expected: { x: number; y: number; w: number; h: number }
) {
  return (
    !!actual &&
    actual.x === expected.x &&
    actual.y === expected.y &&
    actual.w === expected.w &&
    actual.h === expected.h
  );
}

console.log('1) 투명 배경 — 객체만 감지');
{
  const img = makeImage(100, 100, [0, 0, 0, 0], (x, y) =>
    x >= 30 && x < 50 && y >= 40 && y < 70 ? [255, 0, 0, 255] : null
  );
  const r = findTrimBounds(img, { mode: 'transparent' });
  check('bounds = (30,40,20,30)', rectIs(r.rect, { x: 30, y: 40, w: 20, h: 30 }), r);
  check('background = transparent', r.background === 'transparent', r.background);
}

console.log('2) 흰색 배경 — 색상 자동 감지');
{
  const img = makeImage(100, 100, [255, 255, 255, 255], (x, y) =>
    x >= 10 && x < 15 && y >= 10 && y < 15 ? [0, 0, 0, 255] : null
  );
  const r = findTrimBounds(img, { mode: 'auto' });
  check('bounds = (10,10,5,5)', rectIs(r.rect, { x: 10, y: 10, w: 5, h: 5 }), r);
  check('background = color', r.background === 'color', r.background);
}

console.log('3) 완전 단색 — 실패 처리');
{
  const img = makeImage(64, 64, [255, 255, 255, 255]);
  const r = findTrimBounds(img, { mode: 'auto' });
  check('ok = false', r.ok === false, r);
  check("reason = 'empty'", r.reason === 'empty', r.reason);
}

console.log('4) 완전 투명 — 실패 처리');
{
  const img = makeImage(64, 64, [0, 0, 0, 0]);
  const r = findTrimBounds(img, { mode: 'auto' });
  check('ok = false', r.ok === false, r);
}

console.log('5) 허용 오차(tolerance) — 압축 노이즈 무시');
{
  const img = makeImage(80, 80, [250, 250, 250, 255], (x, y) => {
    // 내용(검정 사각형)을 먼저 판정
    if (x >= 30 && x < 40 && y >= 30 && y < 40) return [0, 0, 0, 255];
    // 배경과 3~7 차이 나는 압축 노이즈
    if (x < 40 && y < 40) return [253, 248, 250, 255];
    return null;
  });
  const r = findTrimBounds(img, { mode: 'auto', tolerance: 12 });
  check('노이즈는 무시되고 (30,30,10,10)', rectIs(r.rect, { x: 30, y: 30, w: 10, h: 10 }), r);
}

console.log('6) 내용이 전체를 채움 — fullFrame');
{
  const img = makeImage(50, 40, [0, 0, 0, 255]);
  const r = findTrimBounds(img, { mode: 'transparent' });
  check('bounds = full', rectIs(r.rect, { x: 0, y: 0, w: 50, h: 40 }), r);
  check('fullFrame = true', r.fullFrame === true, r.fullFrame);
}

console.log('7) 패딩 적용 + 프레임 클램프');
{
  const r = padRect({ x: 1, y: 2, w: 10, h: 10 }, 4, { w: 20, h: 20 });
  check('clip → (0,0,15,16)', rectIs(r, { x: 0, y: 0, w: 15, h: 16 }), r);

  const r2 = padRect({ x: 20, y: 20, w: 10, h: 10 }, 4, { w: 100, h: 100 });
  check('expand → (16,16,18,18)', rectIs(r2, { x: 16, y: 16, w: 18, h: 18 }), r2);

  const r3 = padRect({ x: 10, y: 10, w: 20, h: 20 }, 0, { w: 100, h: 100 }, 0.1);
  check('ratio 10% → (8,8,24,24)', rectIs(r3, { x: 8, y: 8, w: 24, h: 24 }), r3);
}

console.log('8) 1px 얇은 선도 감지');
{
  const img = makeImage(200, 200, [0, 0, 0, 0], (x, y) =>
    y === 50 && x === 150 ? [0, 0, 0, 255] : null
  );
  const r = findTrimBounds(img, { mode: 'transparent' });
  check('(150,50,1,1)', rectIs(r.rect, { x: 150, y: 50, w: 1, h: 1 }), r);
}

const opts: TrimOptions = { mode: 'transparent' };
void opts;

console.log(`\n결과: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
