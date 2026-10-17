import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultFactions, pointsAt, scoreMinute, teamScores, validFaction, visibleTo } from '../src/lib/game.ts';
import { hotState, type HotZone } from '../src/lib/hotzone.ts';

const center = { lat: 55.75, lng: 37.62 };
const zone: HotZone = { r: 400, hot: 75, every: 600_000, start: 1_000_000, seed: 42 };
const north = (m: number) => ({ lat: center.lat + m / 111_320, lng: center.lng });

test('points: 2 in the hot zone, 1 in the control zone, 0 outside', () => {
  const st = hotState(center, zone, zone.start + 1000);
  assert.equal(pointsAt({ lat: st.lat, lng: st.lng }, center, zone, st), 2);
  // A spot inside the control zone but away from the hot circle.
  const far = Math.hypot(st.lat - north(-350).lat, st.lng - north(-350).lng) * 111_320 > zone.hot ? north(-350) : north(350);
  assert.equal(pointsAt(far, center, zone, st), 1);
  assert.equal(pointsAt(north(600), center, zone, st), 0);
});

test('scoring minutes count from the zone start', () => {
  assert.equal(scoreMinute(zone, 0), 0);
  assert.equal(scoreMinute(zone, zone.start + 59_999), 0);
  assert.equal(scoreMinute(zone, zone.start + 60_000), 1);
  assert.equal(scoreMinute(zone, zone.start + 30 * 60_000 + 5), 30);
});

test('team totals sum members of each team for that zone only', () => {
  const members: { faction: number | null; pts?: Record<string, number> }[] = [
    { faction: 0, pts: { z1: 5, z0: 100 } },
    { faction: 0, pts: { z1: 3 } },
    { faction: 1, pts: { z1: 7 } },
    { faction: null, pts: { z1: 50 } },
    { faction: 9, pts: { z1: 50 } },
    { faction: 1 },
  ];
  assert.deepEqual(teamScores(members, 'z1', 3), [8, 7, 0]);
});

test('visibility: master sees all, players see their team and public items', () => {
  const player = { gameOn: true, isMaster: false, faction: 1 };
  assert.ok(visibleTo(player, 1));
  assert.ok(!visibleTo(player, 0));
  assert.ok(visibleTo(player, null));
  assert.ok(visibleTo({ gameOn: true, isMaster: true, faction: null }, 0));
  assert.ok(visibleTo({ gameOn: false, isMaster: false, faction: null }, 3));
  // A player not yet assigned sees only public items.
  assert.ok(!visibleTo({ gameOn: true, isMaster: false, faction: null }, 2));
});

test('presets and validation', () => {
  assert.equal(defaultFactions(4).length, 4);
  assert.equal(defaultFactions(9).length, 6);
  assert.ok(validFaction(2, 3));
  assert.ok(!validFaction(3, 3));
  assert.ok(!validFaction(1.5, 3));
});
