import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  abilityReady,
  buildTick,
  CARRY,
  CARRY_DEPOT,
  carryLimit,
  detections,
  mineStep,
  minuteIncome,
  pickups,
  placeError,
  reconScan,
  squadScore,
  squadWinners,
  strikeHits,
  type Site,
} from '../src/lib/squadMode.ts';

// ~1 m in latitude.
const M = 1 / 111320;
const HQ = { owner: 'A', lat: 56.8, lng: 60.6 };
const at = (dy: number) => ({ lat: 56.8 + dy * M, lng: 60.6 });
const site = (id: string, owner: string, dy: number, kind: Site['kind'] = 'b-fob', paid = 0, built = false): Site => ({
  id,
  kind,
  owner,
  ...at(dy),
  bld: { cost: kind === 'b-fob' ? 300 : 250, paid, built, seen: [] },
});

test('buildings stay 200 m clear of any HQ', () => {
  assert.match(placeError(at(150), [HQ]) ?? '', /200 м/);
  assert.equal(placeError(at(260), [HQ]), null);
});

test('a fighter at the HQ fills the pack after 10 s, from the bank, up to the limit', () => {
  const since = new Map<string, number>();
  const f = [{ uid: 'u', sideId: 'A', ...at(5) }];
  let r = pickups(f, {}, { A: 30 }, [HQ], [], since, 0);
  assert.deepEqual(r.carry, {});
  r = pickups(f, {}, { A: 30 }, [HQ], [], since, 10_000);
  assert.deepEqual(r, { carry: { u: 30 }, bank: { A: 0 } });
  r = pickups(f, { u: 10 }, { A: 500 }, [HQ], [], since, 20_000);
  assert.deepEqual(r, { carry: { u: CARRY }, bank: { A: 500 - (CARRY - 10) } });
  // Walking away resets the wait.
  pickups([], {}, { A: 1 }, [HQ], [], since, 30_000);
  assert.equal(since.size, 0);
});

test('a depot raises the pack and is a supply point itself', () => {
  const depot = site('d', 'A', 400, 'b-depot', 250, true);
  assert.equal(carryLimit('A', [depot]), CARRY_DEPOT);
  assert.equal(carryLimit('B', [depot]), CARRY);
  const since = new Map([['u', 0]]);
  const r = pickups([{ uid: 'u', sideId: 'A', ...at(405) }], {}, { A: 1000 }, [HQ], [depot], since, 10_000);
  assert.deepEqual(r.carry, { u: CARRY_DEPOT });
});

test('builders add 1 each per tick from their packs; the site is built at its cost', () => {
  const s = site('s', 'A', 400, 'b-fob', 298);
  const fighters = [
    { uid: 'a', sideId: 'A', ...at(405) },
    { uid: 'b', sideId: 'A', ...at(395) },
    { uid: 'c', sideId: 'A', ...at(500) },
  ];
  const r = buildTick([s], fighters, { a: 5, b: 0, c: 9 });
  assert.equal(r.changed[0].bld.paid, 299);
  assert.deepEqual(r.carry, { a: 4 });
  const r2 = buildTick([s], fighters, { a: 5, b: 5 });
  assert.equal(r2.changed[0].bld.paid, 300);
  assert.equal(r2.changed[0].bld.built, true);
});

test('enemies at a building wreck it 2 each per tick and stop the building; at zero it is gone', () => {
  const s = site('s', 'A', 400, 'b-fob', 3, false);
  const r = buildTick([s], [{ uid: 'e', sideId: 'B', ...at(402) }, { uid: 'a', sideId: 'A', ...at(401) }], { a: 9 });
  assert.equal(r.changed[0].bld.paid, 1);
  assert.deepEqual(r.carry, {});
  const r2 = buildTick([{ ...s, bld: { ...s.bld, paid: 1 } }], [{ uid: 'e', sideId: 'B', ...at(402) }], {});
  assert.deepEqual(r2.wrecked, ['s']);
});

test('enemies within 50 m find a building; recon finds it unless a REB covers it', () => {
  const s = site('s', 'A', 400, 'b-fob', 300, true);
  assert.deepEqual(detections([s], [{ uid: 'e', sideId: 'B', ...at(440) }]), [{ id: 's', side: 'B' }]);
  assert.deepEqual(detections([s], [{ uid: 'e', sideId: 'B', ...at(460) }]), []);
  assert.deepEqual(reconScan('B', at(500), [s], []).sites, ['s']);
  const reb = site('r', 'A', 450, 'b-reb', 150, true);
  assert.deepEqual(reconScan('B', at(500), [s, reb], []).sites, []);
  assert.deepEqual(reconScan('B', at(500), [s], [{ uid: 'a', sideId: 'A', ...at(520) }]).fighters.length, 1);
});

test('air strike hits buildings and mines within 50 m; abilities need a built building and cool down', () => {
  const s = site('s', 'A', 400);
  assert.deepEqual(strikeHits(at(430), [s], [{ id: 'm', ...at(460) }, { id: 'far', ...at(600) }]), { sites: ['s'], mines: ['m'] });
  const air = site('air', 'B', 900, 'b-air', 500, true);
  assert.equal(abilityReady('B', 'b-air', [air], 0)?.id, 'air');
  assert.equal(abilityReady('B', 'b-air', [{ ...air, bld: { ...air.bld, ready: 100 } }], 50), null);
  assert.equal(abilityReady('B', 'b-recon', [air], 0), null);
});

test('mines: held 90 s by the stronger side, blocked after a strike', () => {
  const mine = { ...at(0), owner: null as string | null, mcap: null as { s: string; t: number } | null };
  const two = [{ uid: '1', sideId: 'A', ...at(5) }, { uid: '2', sideId: 'A', ...at(-5) }, { uid: '3', sideId: 'B', ...at(3) }];
  const r = mineStep(mine, two, 0);
  assert.deepEqual(r, { owner: null, mcap: { s: 'A', t: 0 }, captured: false });
  assert.equal(mineStep({ ...mine, mcap: r.mcap }, two, 90_000).owner, 'A');
  assert.equal(mineStep({ ...mine, block: 200_000 }, two, 100_000).mcap, null);
  // A tie holds nothing.
  assert.equal(mineStep(mine, two.slice(1), 0).mcap, null);
});

test('income, score and winner', () => {
  assert.deepEqual(minuteIncome(['A', 'B'], [{ owner: 'A' }, { owner: 'A' }, { owner: null }]), { A: 22, B: 2 });
  const score = squadScore(['A', 'B'], { A: 100, B: 300 }, [site('s', 'A', 400, 'b-fob', 250)]);
  assert.deepEqual(score, { A: 350, B: 300 });
  assert.deepEqual(squadWinners(score), ['A']);
  assert.deepEqual(squadWinners({ A: 5, B: 5 }), ['A', 'B']);
});
