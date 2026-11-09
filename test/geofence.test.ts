import assert from 'node:assert/strict';
import { test } from 'node:test';

import { centroid, insidePolygon, ZoneWatcher, type Area } from '../src/lib/geofence.ts';

const sq = (lat: number, lng: number, d: number) => [
  { lat, lng },
  { lat, lng: lng + d },
  { lat: lat + d, lng: lng + d },
  { lat: lat + d, lng },
];
const dead: Area = { id: 'd', kind: 'area-dead', label: 'Мертвяк', points: sq(56.0, 60.0, 0.001) };
const field: Area = { id: 'f', kind: 'area-bound', label: '', points: sq(55.99, 59.99, 0.03) };
const inDead = { lat: 56.0005, lng: 60.0005, accuracy: 5 };
const inField = { lat: 56.01, lng: 60.01, accuracy: 5 };
const outside = { lat: 56.5, lng: 60.5, accuracy: 5 };

test('point in polygon, including a concave one', () => {
  assert.ok(insidePolygon(inDead, dead.points));
  assert.ok(!insidePolygon(inField, dead.points));
  const L = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 2 },
    { lat: 1, lng: 2 },
    { lat: 1, lng: 1 },
    { lat: 2, lng: 1 },
    { lat: 2, lng: 0 },
  ];
  assert.ok(insidePolygon({ lat: 1.5, lng: 0.5 }, L));
  assert.ok(!insidePolygon({ lat: 1.5, lng: 1.5 }, L));
  assert.deepEqual(centroid(sq(0, 0, 2)), { lat: 1, lng: 1 });
});

test('entering a dead zone alerts once, after two fixes agree', () => {
  const w = new ZoneWatcher();
  assert.deepEqual(w.update(inField, [dead, field]), []);
  assert.deepEqual(w.update(inDead, [dead, field]), []);
  const a = w.update(inDead, [dead, field]);
  assert.equal(a.length, 1);
  assert.equal(a[0].type, 'enter');
  assert.deepEqual(w.update(inDead, [dead, field]), []);
  assert.deepEqual(w.current([dead, field]).map((z) => z.id).sort(), ['d', 'f']);
});

test('jitter across an edge and bad fixes do not alert', () => {
  const w = new ZoneWatcher();
  w.update(inField, [dead, field]);
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(w.update(i % 2 ? inField : inDead, [dead, field]), []);
  }
  assert.deepEqual(w.update({ ...outside, accuracy: 80 }, [dead, field]), []);
  assert.deepEqual(w.update({ ...outside, accuracy: 80 }, [dead, field]), []);
});

test('leaving the field boundary and coming back', () => {
  const w = new ZoneWatcher();
  w.update(inField, [field]);
  w.update(outside, [field]);
  assert.deepEqual(w.update(outside, [field]).map((a) => a.type), ['leaveBound']);
  w.update(inField, [field]);
  assert.deepEqual(w.update(inField, [field]).map((a) => a.type), ['backInBound']);
  // Starting outside the field is not an alert.
  const w2 = new ZoneWatcher();
  assert.deepEqual(w2.update(outside, [field]), []);
  assert.deepEqual(w2.update(outside, [field]), []);
});
