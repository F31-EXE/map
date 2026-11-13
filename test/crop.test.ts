import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clampFrame, cropRect } from '../src/lib/crop.ts';

test('unzoomed landscape photo: the centered square of its height', () => {
  const r = cropRect({ scale: 1, x: 0, y: 0 }, 4000, 3000, 300);
  assert.deepEqual(r, { originX: 500, originY: 0, width: 3000, height: 3000 });
});

test('moving the photo right shows its left part; never past the edge', () => {
  const f = clampFrame({ scale: 1, x: 10_000, y: 50 }, 4000, 3000, 300);
  assert.equal(f.y, 0);
  assert.equal(f.x, 50); // (4000·0.1 − 300) / 2
  assert.equal(cropRect(f, 4000, 3000, 300).originX, 0);
});

test('zoom 2 halves the square around the same center', () => {
  const r = cropRect({ scale: 2, x: 0, y: 0 }, 3000, 3000, 300);
  assert.deepEqual(r, { originX: 750, originY: 750, width: 1500, height: 1500 });
  assert.equal(clampFrame({ scale: 0.3, x: 0, y: 0 }, 10, 10, 300).scale, 1);
});
