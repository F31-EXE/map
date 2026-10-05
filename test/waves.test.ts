import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatCountdown, nextWave, shiftWave, upcomingWaves, validWave } from '../src/lib/waves.ts';

const MIN = 60_000;

test('next departure: at the start, between waves, exactly on a wave', () => {
  const w = { every: 15 * MIN, start: 1_000_000 };
  assert.equal(nextWave(w, 0), 1_000_000);
  assert.equal(nextWave(w, 1_000_000 + 1), 1_000_000 + 15 * MIN);
  assert.equal(nextWave(w, 1_000_000 + 30 * MIN), 1_000_000 + 30 * MIN);
  assert.deepEqual(upcomingWaves(w, 1_000_000 + MIN, 3), [1, 2, 3].map((k) => 1_000_000 + k * 15 * MIN));
});

test('countdown text and schedule shifts', () => {
  assert.equal(formatCountdown(245_000), '4:05');
  assert.equal(formatCountdown(3_725_000), '1:02:05');
  assert.equal(formatCountdown(-5), '0:00');
  assert.equal(shiftWave({ every: MIN, start: 0 }, MIN).start, MIN);
});

test('only sane schedules are accepted', () => {
  assert.equal(validWave({ every: 10 * MIN, start: 1 }), true);
  assert.equal(validWave({ every: 1000, start: 1 }), false);
  assert.equal(validWave({ every: 500 * MIN, start: 1 }), false);
  assert.equal(validWave(null), false);
});
