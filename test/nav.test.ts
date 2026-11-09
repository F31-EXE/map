import assert from 'node:assert/strict';
import { test } from 'node:test';

import { etaSeconds, formatEta, SpeedTracker, WALK_MPS } from '../src/lib/nav.ts';
import { offsetPoint } from '../src/lib/mortar.ts';

test('speed from recent fixes; standing still falls back to walking pace', () => {
  const s = new SpeedTracker();
  const start = { lat: 56.8, lng: 60.6 };
  assert.equal(s.speed(), null);
  for (let i = 0; i <= 20; i++) s.push(offsetPoint(start, 0, i * 2), i * 1000);
  assert.ok(Math.abs(s.speed()! - 2) < 0.05);
  assert.ok(Math.abs(etaSeconds(200, s.speed()) - 100) < 3);
  assert.equal(etaSeconds(125, 0.1), 125 / WALK_MPS);
  // Old fixes drop out of the window.
  for (let i = 0; i < 40; i++) s.push(offsetPoint(start, 0, 40), 21_000 + i * 1000);
  assert.ok(s.speed()! < 0.1);
});

test('eta text', () => {
  assert.equal(formatEta(30), '< 1 мин');
  assert.equal(formatEta(5 * 60 + 10), '5 мин');
  assert.equal(formatEta(75 * 60), '1 ч 15 мин');
});
