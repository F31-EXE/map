import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  chatEnvelope,
  forwarded,
  MAX_HOPS,
  MeshStore,
  mergeMeshMembers,
  pack,
  posEnvelope,
  POS_TTL_MS,
  shouldDial,
  unpack,
  type MeshPos,
} from '../src/lib/mesh.ts';
import type { Member } from '../src/lib/types.ts';

const pos = (uid: string, lat = 55.75): MeshPos => ({
  uid,
  callsign: 'Гром',
  role: 'medic',
  status: 'alive',
  cmd: false,
  lat,
  lng: 37.61,
  heading: 90,
  accuracy: 5,
});

test('news is accepted once; repeats, other squads and long trips are dropped', () => {
  const s = new MeshStore('team1');
  const e = posEnvelope('team1', pos('a'), 1000);
  assert.equal(s.accept(e, 1000), true);
  assert.equal(s.accept(forwarded(e), 1000), false, 'same id via another path');
  assert.equal(s.accept(posEnvelope('team2', pos('b'), 1000), 1000), false);
  let far = chatEnvelope('team1', { id: 'm1', uid: 'a', callsign: 'Гром', text: 'Контакт!' }, 1000);
  for (let i = 0; i <= MAX_HOPS; i++) far = forwarded(far);
  assert.equal(s.accept(far, 1000), false);
});

test('only the freshest position per fighter is kept', () => {
  const s = new MeshStore('t');
  assert.equal(s.accept(posEnvelope('t', pos('a', 1), 2000), 2000), true);
  assert.equal(s.accept(posEnvelope('t', pos('a', 2), 1000), 2000), false, 'older arrives late');
  assert.equal(s.positions.get('a')!.body.lat, 1);
  assert.equal(s.accept(posEnvelope('t', pos('a', 3), 3000), 3000), true);
  assert.equal(s.positions.get('a')!.body.lat, 3);
});

test('a new neighbour gets positions and chat; stale ones are pruned', () => {
  const s = new MeshStore('t');
  s.accept(posEnvelope('t', pos('a'), 0), 0);
  s.accept(posEnvelope('t', pos('b'), POS_TTL_MS), POS_TTL_MS);
  s.accept(chatEnvelope('t', { id: 'm1', uid: 'a', callsign: 'Гром', text: 'Иду' }, POS_TTL_MS), POS_TTL_MS);
  const snap = s.snapshot(POS_TTL_MS + 1);
  assert.deepEqual(
    snap.map((e) => e.id),
    [`p:b:${POS_TTL_MS}`, 'c:m1']
  );
});

test('packets stay under the limit and survive the round trip; garbage is ignored', () => {
  const list = Array.from({ length: 300 }, (_, i) =>
    chatEnvelope('t', { id: `m${i}`, uid: 'a', callsign: 'Гром', text: 'Нужна помощь у северного моста' }, i)
  );
  const packets = pack(list, 4000);
  assert.ok(packets.length > 1);
  for (const p of packets) assert.ok(Buffer.byteLength(p) < 4000);
  assert.equal(packets.flatMap(unpack).length, 300);
  assert.deepEqual(unpack('not json'), []);
  assert.deepEqual(unpack(JSON.stringify([{ v: 1, id: 'x', team: 't', t: 1, hops: 0, kind: 'pos', body: { uid: 'a' } }])), []);
});

test('mesh positions update the roster only when fresher, and add unknown fighters', () => {
  const members: Member[] = [
    { id: 'a', callsign: 'Гром', role: 'commander', canCommand: true, status: 'alive', lat: 1, lng: 1, heading: null, updatedAt: 5000 },
    { id: 'b', callsign: 'Сова', role: 'sniper', canCommand: false, status: 'alive', lat: 1, lng: 1, heading: null, updatedAt: 1000 },
  ];
  const s = new MeshStore('t');
  s.accept(posEnvelope('t', pos('a', 9), 4000), 4000);
  s.accept(posEnvelope('t', { ...pos('b', 9), status: 'dead' }, 4000), 4000);
  s.accept(posEnvelope('t', pos('c', 9), 4000), 4000);
  const out = new Map(mergeMeshMembers(members, s.positions.values()).map((m) => [m.id, m]));
  assert.equal(out.get('a')!.lat, 1, 'server is fresher');
  assert.equal(out.get('b')!.lat, 9);
  assert.equal(out.get('b')!.status, 'dead');
  assert.equal(out.get('b')!.role, 'sniper', 'role comes from the server when known');
  assert.equal(out.get('c')!.viaMesh, true);
});

test('exactly one of two phones dials', () => {
  assert.notEqual(shouldDial('t|aaa|x', 't|bbb|y'), shouldDial('t|bbb|y', 't|aaa|x'));
});
