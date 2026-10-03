import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resampleByTime, splitSegments, trackStats, type TrackPoint } from '../src/lib/tracks.ts';

const p = (lat: number, t: number): TrackPoint => ({ lat, lng: 37, t });

test('resampling weighs by time, not by how often points were sent', () => {
  // 60 s walking with a point every 5 s, then 60 s standing still with one heartbeat.
  const walk = Array.from({ length: 13 }, (_, i) => p(55 + i * 1e-4, i * 5000));
  const stand = [p(55.0012, 90_000), p(55.0012, 120_000)];
  const out = resampleByTime([...walk, ...stand], 10_000);
  const standing = out.filter((q) => Math.abs(q.lat - 55.0012) < 1e-9).length;
  assert.equal(out.length, 12); // 120 s / 10 s
  assert.ok(standing >= 5, `standing samples: ${standing}`);
});

test('long gaps are neither interpolated nor drawn', () => {
  const pts = [p(55, 0), p(55.001, 10_000), p(56, 10 * 60_000), p(56.001, 10 * 60_000 + 10_000)];
  assert.equal(resampleByTime(pts, 10_000).length, 2);
  assert.equal(splitSegments(pts).length, 2);
});

test('distance and duration skip gaps', () => {
  const pts = [p(55, 0), p(55.001, 60_000), p(56, 30 * 60_000), p(56.001, 31 * 60_000)];
  const { distance, duration } = trackStats(pts);
  assert.ok(Math.abs(distance - 222.4) < 1, `distance ${distance}`);
  assert.equal(duration, 120_000);
});
