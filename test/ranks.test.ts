import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canDeleteMarker, rankOf } from '../src/lib/ranks.ts';

const ctx = { ownerId: 'cmd', sideOwnerId: 'side', commanders: new Set(['sgt']) };
const m = (createdBy: string) => ({ createdBy });

test('ranks follow the chain of command', () => {
  assert.deepEqual(['side', 'cmd', 'sgt', 'pvt'].map((u) => rankOf(u, ctx)), [4, 3, 2, 1]);
});

test('own markers are always deletable', () => {
  for (const u of ['side', 'cmd', 'sgt', 'pvt']) assert.equal(canDeleteMarker(u, m(u), ctx), true);
});

test('superiors delete subordinates, never the other way round', () => {
  assert.equal(canDeleteMarker('cmd', m('sgt'), ctx), true);
  assert.equal(canDeleteMarker('sgt', m('pvt'), ctx), true);
  assert.equal(canDeleteMarker('side', m('cmd'), ctx), true);
  assert.equal(canDeleteMarker('pvt', m('sgt'), ctx), false);
  assert.equal(canDeleteMarker('sgt', m('cmd'), ctx), false);
  assert.equal(canDeleteMarker('cmd', m('side'), ctx), false);
});

test('equals cannot delete each other; personal markers are always yours', () => {
  assert.equal(canDeleteMarker('pvt', m('pvt2'), ctx), false);
  assert.equal(canDeleteMarker('pvt', { createdBy: 'local', personal: true }, ctx), true);
});
