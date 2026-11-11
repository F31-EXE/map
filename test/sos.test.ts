import assert from 'node:assert/strict';
import { test } from 'node:test';

import { activeSos, isSosCancel, parseSos, sosCancelText, sosText, SOS_TTL_MS } from '../src/lib/sos';

test('SOS text round-trips its coordinates', () => {
  const t = sosText(56.838123, 60.603512);
  assert.deepEqual(parseSos(t), { lat: 56.83812, lng: 60.60351 });
  assert.deepEqual(parseSos(sosText(-33.5, -70.25)), { lat: -33.5, lng: -70.25 });
  assert.equal(parseSos('SOS 56.1, 60.2'), null);
  assert.equal(parseSos('привет'), null);
  assert.ok(isSosCancel(sosCancelText()));
  assert.ok(!isSosCancel(t));
});

test('activeSos keeps the latest open call per fighter', () => {
  const now = 1_000_000_000;
  const msg = (id: string, uid: string, text: string, ago: number) => ({ id, uid, callsign: uid, text, createdAt: now - ago });
  const calls = activeSos(
    [
      msg('1', 'a', sosText(1, 2), 60_000),
      msg('2', 'a', sosText(3, 4), 30_000),
      msg('3', 'b', sosText(5, 6), 50_000),
      msg('4', 'b', sosCancelText(), 40_000),
      msg('5', 'c', sosText(7, 8), SOS_TTL_MS + 1),
      msg('6', 'd', 'обычное сообщение', 1000),
    ],
    now
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].uid, 'a');
  assert.equal(calls[0].lat, 3);
  // A new call after a cancel is open again.
  assert.equal(activeSos([msg('7', 'b', sosCancelText(), 20_000), msg('8', 'b', sosText(1, 1), 10_000)], now).length, 1);
});
