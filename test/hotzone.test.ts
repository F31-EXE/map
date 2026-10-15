import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { distanceMeters } from '../src/lib/geo.ts';
import { hotState, hzPoint, hzTiming, newZone, validZone, type HotZone } from '../src/lib/hotzone.ts';

const MIN = 60_000;
const center = { lat: 55.75, lng: 37.62 };
const z: HotZone = { r: 400, hot: 75, every: 10 * MIN, start: 1_000_000, seed: 12345 };

test('hot zone always stays inside the control zone', () => {
  for (let k = 0; k < 500; k++) {
    const p = hzPoint(center, z, k);
    assert.ok(distanceMeters(center, p) + z.hot <= z.r + 1, `period ${k}`);
  }
});

test('spots differ between periods and seeds, and are reproducible', () => {
  const a = hzPoint(center, z, 1);
  assert.deepEqual(hzPoint(center, z, 1), a);
  assert.notDeepEqual(hzPoint(center, z, 2), a);
  assert.notDeepEqual(hzPoint(center, { ...z, seed: 999 }, 1), a);
});

test('phases: hold, then the next spot is revealed, then it slides there', () => {
  const { move, warn } = hzTiming(z.every);
  const hold = hotState(center, z, z.start + 1000);
  assert.equal(hold.phase, 'hold');
  assert.equal(hold.next, null);
  assert.equal(hold.at, z.start + z.every - move - warn);

  const w = hotState(center, z, hold.at + 1);
  assert.equal(w.phase, 'warn');
  assert.deepEqual(w.next, hzPoint(center, z, 1));
  assert.equal(w.lat, hold.lat);

  const mid = hotState(center, z, z.start + z.every - move / 2);
  assert.equal(mid.phase, 'move');
  const a = hzPoint(center, z, 0);
  const b = hzPoint(center, z, 1);
  assert.ok(Math.abs(mid.lat - (a.lat + b.lat) / 2) < 1e-9);

  const after = hotState(center, z, z.start + z.every);
  assert.equal(after.k, 1);
  assert.equal(after.phase, 'hold');
  assert.deepEqual({ lat: after.lat, lng: after.lng }, b);
});

test('before the start the first spot holds', () => {
  const s = hotState(center, z, 0);
  assert.equal(s.k, 0);
  assert.equal(s.phase, 'hold');
});

test('validation', () => {
  assert.ok(validZone(z));
  assert.ok(validZone(newZone()));
  assert.ok(!validZone({ ...z, hot: 500 }));
  assert.ok(!validZone({ ...z, every: 1000 }));
  assert.ok(!validZone(null));
});

test('the map page computes the same circle (map.js copy)', () => {
  const src = readFileSync(new URL('../src/map/web/map.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('// hz:begin'), src.indexOf('// hz:end'));
  assert.ok(block.length > 100);
  const hzState = new Function(`${block}; return hzState;`)() as (
    lat: number,
    lng: number,
    z: HotZone,
    now: number
  ) => { lat: number; lng: number; next: { lat: number; lng: number } | null; phase: string; at: number };
  for (const now of [0, z.start + 5 * MIN, z.start + 9.5 * MIN, z.start + 37 * MIN, z.start + 123 * MIN]) {
    const a = hotState(center, z, now);
    const b = hzState(center.lat, center.lng, z, now);
    assert.equal(b.phase, a.phase);
    assert.equal(b.at, a.at);
    assert.ok(Math.abs(b.lat - a.lat) < 1e-12 && Math.abs(b.lng - a.lng) < 1e-12);
    assert.deepEqual(b.next, a.next);
  }
});
