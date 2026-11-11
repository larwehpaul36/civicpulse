import test from 'node:test';
import assert from 'node:assert/strict';
import { normRect, isUsableRect, blockSize, grow, pixelate, pixelateAll } from '../lib/blur.js';

// A W x H image where every pixel has a different colour, so any change is visible.
function image(W, H) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { d[i * 4] = i % 251; d[i * 4 + 1] = (i * 7) % 253; d[i * 4 + 2] = (i * 13) % 241; d[i * 4 + 3] = 255; }
  return d;
}

test('normRect handles any drag direction and clamps to the image', () => {
  assert.deepEqual(normRect({ x: 50, y: 40 }, { x: 10, y: 5 }, 100, 100), { x: 10, y: 5, w: 40, h: 35 });
  assert.deepEqual(normRect({ x: -20, y: -5 }, { x: 150, y: 120 }, 100, 80), { x: 0, y: 0, w: 100, h: 80 });
});

test('tiny accidental boxes are ignored', () => {
  assert.equal(isUsableRect({ x: 0, y: 0, w: 5, h: 50 }), false);
  assert.equal(isUsableRect({ x: 0, y: 0, w: 30, h: 30 }), true);
  assert.equal(isUsableRect(null), false);
});

test('block size scales with the box but never goes under 6', () => {
  assert.equal(blockSize({ w: 20, h: 20 }), 6);
  assert.equal(blockSize({ w: 400, h: 100 }), 25);
});

test('grow adds a margin and stays inside the image', () => {
  assert.deepEqual(grow({ x: 10, y: 10, w: 100, h: 100 }, 0.2, 200, 200), { x: 0, y: 0, w: 130, h: 130 });
});

test('pixelate changes only the chosen box, and the box ends up as flat blocks', () => {
  const W = 60, H = 40, before = image(W, H), after = image(W, H);
  const rect = { x: 10, y: 8, w: 24, h: 24 }; // block size 6
  pixelate(after, W, H, rect);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, inside = x >= 10 && x < 34 && y >= 8 && y < 32;
    const same = before[i] === after[i] && before[i + 1] === after[i + 1] && before[i + 2] === after[i + 2];
    if (!inside) assert.ok(same, `outside pixel ${x},${y} changed`);
  }
  // inside: every pixel of one 6x6 block has the same colour
  const px = (x, y) => [after[(y * W + x) * 4], after[(y * W + x) * 4 + 1], after[(y * W + x) * 4 + 2]].join();
  for (let by = 8; by < 32; by += 6) for (let bx = 10; bx < 34; bx += 6)
    for (let y = by; y < by + 6; y++) for (let x = bx; x < bx + 6; x++) assert.equal(px(x, y), px(bx, by));
  // and the detail is actually gone (not all pixels equal their originals)
  let changed = 0;
  for (let y = 8; y < 32; y++) for (let x = 10; x < 34; x++) if (before[(y * W + x) * 4] !== after[(y * W + x) * 4]) changed++;
  assert.ok(changed > 400, 'most pixels in the box should differ from the original');
});

test('block average is correct and alpha is untouched', () => {
  const d = new Uint8ClampedArray([0, 0, 0, 255, 100, 200, 50, 255, 0, 0, 0, 255, 100, 200, 50, 255]); // 2x2
  pixelate(d, 2, 2, { x: 0, y: 0, w: 2, h: 2 }); // block 6 covers all
  assert.deepEqual([...d.slice(0, 3)], [50, 100, 25]);
  assert.equal(d[3], 255);
});

test('boxes partly or fully outside the image do not throw or write outside', () => {
  const W = 20, H = 20, d = image(W, H), len = d.length;
  pixelateAll(d, W, H, [{ x: 15, y: 15, w: 50, h: 50 }, { x: 100, y: 100, w: 30, h: 30 }, { x: -10, y: -10, w: 15, h: 15 }]);
  assert.equal(d.length, len);
});
