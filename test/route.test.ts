import assert from 'node:assert/strict';
import { test } from 'node:test';

import { routeRemaining, routeStart, routeStep } from '../src/lib/route.ts';

const m = 1 / 111_195;
const route = [
  { lat: 56, lng: 60 },
  { lat: 56 + 100 * m, lng: 60 },
  { lat: 56 + 105 * m, lng: 60 },
  { lat: 56 + 300 * m, lng: 60 },
];

test('route: start at the nearest point', () => {
  assert.equal(routeStart(route, { lat: 56 - 30 * m, lng: 60 }), 0);
  assert.equal(routeStart(route, { lat: 56 + 90 * m, lng: 60 }), 1);
});

test('route: step past points I reached, including ones close together', () => {
  assert.equal(routeStep(route, 0, { lat: 56 + 50 * m, lng: 60 }, 15), 0, 'not there yet');
  assert.equal(routeStep(route, 1, { lat: 56 + 98 * m, lng: 60 }, 15), 3, 'points 1 and 2 are both within 15 m');
  assert.equal(routeStep(route, 3, { lat: 56 + 300 * m, lng: 60 }, 15), 3, 'stays at the end');
});

test('route: meters left', () => {
  const left = routeRemaining(route, 1, { lat: 56 + 50 * m, lng: 60 });
  assert.ok(Math.abs(left - 250) < 1, String(left));
  assert.equal(routeRemaining([], 0, { lat: 0, lng: 0 }), 0);
});
