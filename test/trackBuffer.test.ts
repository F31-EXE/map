import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addPoint,
  dropSent,
  nextBatch,
  pendingCount,
  pendingKey,
  shouldSample,
  TRACK_BATCH,
  TRACK_MAX_POINTS,
  type PendingTracks,
} from '../src/lib/trackBuffer.ts';

const at = (i: number, t: number) => ({ lat: 55.75 + i * 0.0001, lng: 37.62, t });

test('sampling: first point, then only after moving, plus a heartbeat', () => {
  assert.ok(shouldSample(null, at(0, 0), 0));
  const last = at(0, 0);
  assert.ok(!shouldSample(last, at(5, 0), 1000), 'too soon');
  assert.ok(!shouldSample(last, at(0, 0), 10_000), 'standing still');
  assert.ok(shouldSample(last, at(1, 0), 10_000), 'moved ~11 m');
  assert.ok(shouldSample(last, at(0, 0), 31_000), 'heartbeat');
});

test('points queue per recording and leave once uploaded', () => {
  let buf: PendingTracks = {};
  const k1 = pendingKey('team', 'r1');
  const k2 = pendingKey('team', 'r2');
  for (let i = 0; i < TRACK_BATCH + 10; i++) buf = addPoint(buf, k1, at(i, i * 5000));
  buf = addPoint(buf, k2, at(0, 1));
  assert.equal(pendingCount(buf), TRACK_BATCH + 11);

  const b1 = nextBatch(buf)!;
  assert.equal(b1.key, k1);
  assert.equal(b1.points.length, TRACK_BATCH);
  // A point recorded while the upload was in flight stays queued.
  buf = addPoint(buf, k1, at(999, 999_999_999));
  buf = dropSent(buf, k1, b1.points);
  assert.equal(buf[k1].length, 11);

  buf = dropSent(buf, k1, nextBatch(buf)!.points);
  assert.equal(buf[k1], undefined);
  assert.deepEqual(nextBatch(buf), { key: k2, points: [at(0, 1)] });
  buf = dropSent(buf, k2, [at(0, 1)]);
  assert.equal(nextBatch(buf), null);
});

test('a very long offline game keeps the latest points', () => {
  let buf: PendingTracks = {};
  for (let i = 0; i < TRACK_MAX_POINTS + 5; i++) buf = addPoint(buf, 'k', at(0, i));
  assert.equal(buf.k.length, TRACK_MAX_POINTS);
  assert.equal(buf.k[0].t, 5);
});
