import assert from 'node:assert/strict';
import { test } from 'node:test';

import { insidePolygon } from '../src/lib/geofence.ts';
import type { Ball } from '../src/lib/gameModes.ts';
import {
  BALL_SPEED,
  ballCounts,
  ballPush,
  checkpointsPassed,
  convoyResult,
  routeCheckpoints,
  pathLength,
  pointAlong,
  rollBall,
  territoryMinute,
  territoryResult,
  heldMinutes,
  holdings,
  leaders,
  matchState,
  sectorAt,
  territorySectors,
  ticketsLeft,
  zonePoints,
} from '../src/lib/gameModes.ts';
import { distanceMeters } from '../src/lib/geo.ts';

test('match clock: running minute and time left, then over (or stopped early)', () => {
  const m = { start: 1_000_000, minutes: 30 };
  assert.deepEqual(matchState(null, 0), { phase: 'none' });
  const s = matchState(m, m.start + 5 * 60_000 + 10);
  assert.equal(s.phase, 'running');
  if (s.phase === 'running') {
    assert.equal(s.minute, 5);
    assert.equal(s.left, 25 * 60_000 - 10);
  }
  assert.equal(matchState(m, m.start + 30 * 60_000).phase, 'over');
  assert.equal(matchState({ ...m, stoppedAt: m.start + 60_000 }, m.start + 2 * 60_000).phase, 'over');
});

test('territory: nine sectors of the given size, numbered by the snail', () => {
  const c = { lat: 56.827, lng: 60.6165 };
  const secs = territorySectors(c, 200);
  assert.deepEqual(secs.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const nine = secs.find((s) => s.n === 9)!;
  assert.ok(insidePolygon(c, nine.points));
  assert.ok(Math.abs(distanceMeters(nine.points[0], nine.points[1]) - 200) < 1);
  // Top-left is 1, top-right 3, middle-right 4, bottom-left 7.
  const one = secs.find((s) => s.n === 1)!.center;
  const three = secs.find((s) => s.n === 3)!.center;
  const four = secs.find((s) => s.n === 4)!.center;
  const seven = secs.find((s) => s.n === 7)!.center;
  assert.ok(one.lat > c.lat && one.lng < c.lng);
  assert.ok(three.lat > c.lat && three.lng > c.lng);
  assert.ok(Math.abs(four.lat - c.lat) < 1e-9 && four.lng > c.lng);
  assert.ok(seven.lat < c.lat && seven.lng < c.lng);
  const ids = secs.map((s) => ({ id: `s${s.n}`, points: s.points }));
  assert.equal(sectorAt(three, ids)?.id, 's3');
  assert.equal(sectorAt({ lat: 57, lng: 61 }, ids), null);
});

const crowd = (side: string, n: number, minute: number, cell = 's1') =>
  Array.from({ length: n }, () => ({ sideId: side, cell, cellAt: minute }));

test('three minutes of advantage take a sector (10 blue vs 7 green)', () => {
  let sec: { id: string; owner: string | null; cap: { s: string; n: number } | null } = { id: 's1', owner: 'green', cap: null };
  const step = (players: { sideId: string; cell: string; cellAt: number }[], minute: number) => {
    const u = territoryMinute(players, [sec], minute)[0];
    if (u) sec = { ...sec, cap: u.cap, owner: u.owner ?? sec.owner };
    return u;
  };
  step([...crowd('blue', 10, 1), ...crowd('green', 7, 1)], 1);
  assert.deepEqual(sec.cap, { s: 'blue', n: 1 });
  step([...crowd('blue', 10, 2), ...crowd('green', 7, 2)], 2);
  assert.equal(sec.owner, 'green');
  const done = step([...crowd('blue', 10, 3), ...crowd('green', 7, 3)], 3);
  assert.equal(done?.owner, 'blue');
  assert.equal(sec.owner, 'blue');
  assert.equal(sec.cap, null);
});

test('a tie pauses the capture, the other side advantage restarts it, an empty sector cancels it', () => {
  const s = { id: 's1', owner: null, cap: { s: 'blue', n: 2 } };
  // Tie: contested, nothing changes.
  assert.deepEqual(territoryMinute([...crowd('blue', 5, 4), ...crowd('green', 5, 4)], [s], 4), []);
  // Green gets the upper hand: their own count from 1.
  assert.deepEqual(territoryMinute([...crowd('blue', 4, 4), ...crowd('green', 5, 4)], [s], 4), [
    { id: 's1', cap: { s: 'green', n: 1 } },
  ]);
  // Nobody there: the capture is off.
  assert.deepEqual(territoryMinute([], [s], 4), [{ id: 's1', cap: null }]);
  // The owner holding its own sector cancels an attacker's progress.
  assert.deepEqual(territoryMinute(crowd('green', 3, 4), [{ id: 's1', owner: 'green', cap: { s: 'blue', n: 1 } }], 4), [
    { id: 's1', cap: null },
  ]);
  // Reports from another minute don't count.
  assert.deepEqual(territoryMinute(crowd('blue', 3, 9), [{ id: 's1', owner: null, cap: null }], 4), []);
});

test('match result: most sectors wins; a tie is a draw or goes to the longer holder', () => {
  const sectors = [
    { owner: 'blue', log: [{ s: 'blue', t: 0 }] },
    { owner: 'green', log: [{ s: 'green', t: 20 * 60_000 }] },
    { owner: null, log: [] },
  ];
  const r = territoryResult(sectors, 30 * 60_000, 'draw');
  assert.deepEqual(r.count, { blue: 1, green: 1 });
  assert.deepEqual(r.winners.sort(), ['blue', 'green']);
  assert.deepEqual(territoryResult(sectors, 30 * 60_000, 'time').winners, ['blue']);
  assert.deepEqual(holdings([{ owner: 'blue' }, { owner: 'blue' }, { owner: 'green' }, { owner: null }]), { blue: 2, green: 1 });
});

test('flags: minutes held from the capture log; tickets; zone points; leaders', () => {
  const log = [
    { s: 'blue', t: 0 },
    { s: 'red', t: 10 * 60_000 },
    { s: 'blue', t: 13 * 60_000 },
  ];
  assert.deepEqual(heldMinutes(log, 20 * 60_000), { blue: 17, red: 3 });
  const players = [
    { sideId: 'blue', deaths: 3, pts: { z: 4 } },
    { sideId: 'blue', deaths: 2, pts: { z: 2 } },
    { sideId: 'red', deaths: 1 },
  ];
  assert.deepEqual(ticketsLeft(100, [{ id: 'blue' }, { id: 'red', tickets: 5 }], players), { blue: 95, red: 104 });
  assert.deepEqual(zonePoints(players, 'z'), { blue: 6 });
  assert.deepEqual(leaders({ blue: 5, red: 5, green: 1 }).sort(), ['blue', 'red']);
  assert.deepEqual(leaders({}), []);
});

test('convoy: each enemy cancels one escort, never backward, at most 5', () => {
  assert.equal(ballPush(0, 0), 0);
  assert.equal(ballPush(1, 0), 1);
  assert.equal(ballPush(3, 0), 3, 'escorts alone: faster with more');
  assert.equal(ballPush(9, 0), 5, 'no faster beyond 5');
  assert.equal(ballPush(3, 1), 2, 'three push, one enemy: two');
  assert.equal(ballPush(2, 2), 0, 'equal: stands');
  assert.equal(ballPush(1, 3), 0, 'more enemies: still stands');
  assert.equal(ballPush(0, 4), 0, 'enemies alone: stands, never goes back');
  assert.equal(ballPush(12, 4), 5);
});

test('convoy: checkpoints along the route', () => {
  const m = 1 / 111_195;
  const route = [
    { lat: 56, lng: 60 },
    { lat: 56 + 100 * m, lng: 60 },
    { lat: 56 + 250 * m, lng: 60 },
  ];
  const cps = routeCheckpoints(route);
  assert.equal(cps.length, 2);
  assert.ok(Math.abs(cps[0] - 100) < 0.5 && Math.abs(cps[1] - 250) < 0.5);
  assert.equal(checkpointsPassed(route, 50), 0);
  assert.equal(checkpointsPassed(route, 120), 1);
  assert.equal(checkpointsPassed(route, pathLength(route)), 2, 'the base is the last checkpoint');
});

test('convoy: path, counts and rolling', () => {
  const a = { lat: 56, lng: 60 };
  const b = { lat: 56 + 100 / 111_195, lng: 60 };
  const len = pathLength([a, b]);
  assert.ok(Math.abs(len - 100) < 0.5);
  const mid = pointAlong([a, b], 50);
  assert.ok(Math.abs(mid.lat - (a.lat + b.lat) / 2) < 1e-9);
  assert.deepEqual(pointAlong([a, b], 500), b);

  const c = ballCounts(mid, 'blue', [
    { sideId: 'blue', ...mid },
    { sideId: 'blue', lat: mid.lat + 5 / 111_195, lng: mid.lng },
    { sideId: 'red', lat: mid.lat - 8 / 111_195, lng: mid.lng },
    { sideId: 'red', lat: mid.lat + 30 / 111_195, lng: mid.lng },
  ]);
  assert.deepEqual(c, { owners: 2, opponents: 1 });

  let ball: Ball = { progress: 0, at: 0, push: 2, goal: null };
  ball = rollBall(ball, len, 60_000, 0);
  assert.equal(ball.progress, 2 * BALL_SPEED);
  ball = rollBall(ball, len, 120_000 * 10, 0);
  assert.equal(ball.progress, 2 * BALL_SPEED, 'stands while blocked');
  ball = rollBall({ progress: 95, at: 0, push: 5, goal: null }, len, 60_000, 5);
  assert.equal(ball.progress, len);
  assert.equal(ball.goal, 60_000);
  assert.equal(rollBall(ball, len, 999_999, -5), ball, 'a goal stays');
});

test('convoy: result', () => {
  const sides = ['blue', 'red'];
  assert.deepEqual(
    convoyResult(
      [
        { owner: 'blue', progress: 300, length: 300, checkpoints: 3, goal: 5000 },
        { owner: 'red', progress: 300, length: 300, checkpoints: 3, goal: 4000 },
      ],
      sides
    ),
    ['red'],
    'first delivered wins'
  );
  assert.deepEqual(
    convoyResult(
      [
        { owner: 'blue', progress: 150, length: 300, checkpoints: 1 },
        { owner: 'red', progress: 290, length: 400, checkpoints: 2 },
      ],
      sides
    ),
    ['red'],
    'more checkpoints beat a bigger share'
  );
  assert.deepEqual(
    convoyResult(
      [
        { owner: 'blue', progress: 100, length: 200, checkpoints: 1 },
        { owner: 'red', progress: 200, length: 400, checkpoints: 1 },
      ],
      sides
    ).sort(),
    ['blue', 'red'],
    'same checkpoints and share: draw'
  );
  assert.deepEqual(
    convoyResult([{ owner: 'blue', progress: 180, length: 250, checkpoints: 2 }], sides),
    ['red'],
    'one convoy not delivered: the defenders win'
  );
  assert.deepEqual(convoyResult([{ owner: 'blue', progress: 250, length: 250, checkpoints: 3, goal: 1 }], sides), ['blue']);
});
