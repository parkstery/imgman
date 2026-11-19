import assert from 'node:assert/strict';
import { fitImageToCanvas } from '../src/utils/fitImageToCanvas';

const canvas = { width: 1280, height: 720 };
const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

for (const [width, height, rotation] of [
  [100, 50, 0], [50, 100, 0], [100, 100, 0],
  [2000, 1000, 0], [100, 50, 90], [100, 50, 45], [100, 50, -30],
]) {
  const fitted = fitImageToCanvas({ width, height, rotation }, canvas)!;
  close(fitted.width / fitted.height, width / height);
  close(fitted.x + fitted.width / 2, canvas.width / 2);
  close(fitted.y + fitted.height / 2, canvas.height / 2);
  const angle = rotation * Math.PI / 180;
  const boundsWidth = fitted.width * Math.abs(Math.cos(angle)) + fitted.height * Math.abs(Math.sin(angle));
  const boundsHeight = fitted.width * Math.abs(Math.sin(angle)) + fitted.height * Math.abs(Math.cos(angle));
  assert.ok(boundsWidth <= canvas.width + 1e-8);
  assert.ok(boundsHeight <= canvas.height + 1e-8);
  assert.ok(Math.abs(boundsWidth - canvas.width) < 1e-8 || Math.abs(boundsHeight - canvas.height) < 1e-8);
  const repeated = fitImageToCanvas({ ...fitted, rotation }, canvas)!;
  close(repeated.width, fitted.width);
  close(repeated.height, fitted.height);
}

assert.deepEqual(fitImageToCanvas({ width: 100, height: 50, rotation: 0 }, canvas), {
  x: 0, y: 40, width: 1280, height: 640,
});
for (const width of [0, -1, NaN, Infinity]) {
  assert.equal(fitImageToCanvas({ width, height: 50, rotation: 0 }, canvas), null);
}
assert.equal(fitImageToCanvas({ width: 100, height: 50, rotation: 0 }, { width: 0, height: 720 }), null);
console.log('PASS: image fit preserves ratio, maximizes within canvas, centers, respects rotation, and rejects invalid sizes.');
