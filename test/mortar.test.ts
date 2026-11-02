import assert from 'node:assert/strict';
import { test } from 'node:test';

import { distanceMeters, bearingDegrees } from '../src/lib/geo.ts';
import { correct, DEFAULT_MORTAR, formatMils, offsetPoint, solve, validConfig } from '../src/lib/mortar.ts';

const gun = { lat: 55.75, lng: 37.62 };

test('model: max range at 45°, closer targets need a steeper tube', () => {
  const far = solve(gun, offsetPoint(gun, 30, 199.9), DEFAULT_MORTAR);
  assert.equal(far.reach, 'ok');
  assert.ok(Math.abs(far.angle! - 45) < 2.5);
  const mid = solve(gun, offsetPoint(gun, 30, 100), DEFAULT_MORTAR);
  assert.ok(Math.abs(mid.angle! - 75) < 0.5); // 90 − ½·asin(0.5) = 75°
  assert.ok(Math.abs(mid.bearing - 30) < 0.5);
  assert.ok(Math.abs(mid.dist - 100) < 1);
  assert.ok(mid.flight! > 0);
});

test('out of range and too close', () => {
  assert.equal(solve(gun, offsetPoint(gun, 0, 250), DEFAULT_MORTAR).reach, 'far');
  assert.equal(solve(gun, offsetPoint(gun, 0, 250), DEFAULT_MORTAR).angle, null);
  assert.equal(solve(gun, offsetPoint(gun, 0, 10), DEFAULT_MORTAR).reach, 'close');
});

test('test shots override the model and interpolate', () => {
  const cfg = { range: 200, table: [{ angle: 80, dist: 60 }, { angle: 60, dist: 160 }, { angle: 70, dist: 110 }] };
  const s = solve(gun, offsetPoint(gun, 90, 135), cfg);
  assert.ok(s.calibrated);
  assert.ok(Math.abs(s.angle! - 65) < 0.3);
  // Past the last shot the end segment is extended.
  const e = solve(gun, offsetPoint(gun, 90, 185), cfg);
  assert.ok(Math.abs(e.angle! - 55) < 0.3);
});

test('mils, corrections and config parsing', () => {
  assert.equal(formatMils(0), '0-00');
  assert.equal(formatMils(90), '15-00');
  assert.equal(formatMils(359.99), '0-00');
  assert.equal(formatMils(45), '7-50');
  const target = offsetPoint(gun, 0, 150);
  const longer = correct(gun, target, 20, 0);
  assert.ok(Math.abs(distanceMeters(gun, longer) - 170) < 0.5);
  const right = correct(gun, target, 0, 10);
  assert.ok(Math.abs(distanceMeters(target, right) - 10) < 0.2);
  assert.ok(bearingDegrees(gun, right) > 0 && bearingDegrees(gun, right) < 10);
  assert.deepEqual(validConfig(null), DEFAULT_MORTAR);
  assert.deepEqual(validConfig({ range: 300, table: [{ angle: 60, dist: 100 }, { angle: 'x' }] }), {
    range: 300,
    table: [{ angle: 60, dist: 100 }],
  });
});
