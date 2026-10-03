import assert from 'node:assert/strict';
import { test } from 'node:test';

import { angleDiff, HeadingSmoother } from '../src/lib/heading.ts';

test('angleDiff wraps around north', () => {
  assert.equal(angleDiff(359, 1), 2);
  assert.equal(angleDiff(10, 350), 20);
  assert.equal(angleDiff(90, 270), 180);
});

test('smoother averages across 0°/360° without swinging to 180°', () => {
  const s = new HeadingSmoother(0.5);
  s.push(358);
  const v = s.push(4);
  assert.ok(angleDiff(v, 1) < 1.5, `got ${v}`);
});

test('smoother damps jitter around a steady heading', () => {
  const s = new HeadingSmoother();
  let v = 0;
  for (let i = 0; i < 50; i++) v = s.push(90 + (i % 2 ? 6 : -6));
  assert.ok(angleDiff(v, 90) < 2, `got ${v}`);
});
