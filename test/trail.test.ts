import assert from 'node:assert/strict';
import { test } from 'node:test';

import { offsetPoint } from '../src/lib/mortar.ts';
import { addCrumb, recentTrail, type TrailPoint } from '../src/lib/trail.ts';

const start = { lat: 56.8, lng: 60.6 };

test('crumbs every few meters, not while standing, not from rough fixes', () => {
  let t: TrailPoint[] = [];
  t = addCrumb(t, start, 0);
  t = addCrumb(t, offsetPoint(start, 90, 2), 1000);
  assert.equal(t.length, 1);
  t = addCrumb(t, offsetPoint(start, 90, 8), 2000);
  assert.equal(t.length, 2);
  t = addCrumb(t, { ...offsetPoint(start, 90, 50), accuracy: 120 }, 3000);
  assert.equal(t.length, 2);
  // Standing still for long refreshes the last crumb instead of adding.
  t = addCrumb(t, offsetPoint(start, 90, 8), 70_000);
  assert.equal(t.length, 2);
  assert.equal(t[1].t, 70_000);
});

test('only the chosen minutes are shown, an hour is kept', () => {
  let t: TrailPoint[] = [];
  for (let i = 0; i < 90; i++) t = addCrumb(t, offsetPoint(start, 0, i * 10), i * 60_000);
  const now = 89 * 60_000;
  assert.ok(t.every((c) => now - c.t <= 60 * 60_000));
  assert.equal(recentTrail(t, 15, now).length, 16);
  assert.equal(recentTrail(t, 0, now).length, 0);
});
