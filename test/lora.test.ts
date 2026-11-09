import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeEnvelope, encodeEnvelope, fragment, MAX_FRAGMENTS, Reassembler, teamHash } from '../src/lib/lora.ts';
import { chatEnvelope, markEnvelope, posEnvelope, voteEnvelope } from '../src/lib/mesh.ts';
import {
  decodeFromRadio,
  hasSquadChannel,
  MAX_PAYLOAD,
  nodeIdText,
  sendPacket,
  setSquadChannel,
  squadPsk,
  wantConfig,
} from '../src/lib/meshtastic.ts';
import { Fields, utf8Clip, utf8Decode, utf8Encode, Writer } from '../src/lib/protobuf.ts';
import { sha256 } from '../src/lib/sha256.ts';

const TEAM = 'Xy7teamIdForTests01';
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

test('sha256 matches known vectors', () => {
  assert.equal(hex(sha256(utf8Encode(''))), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(hex(sha256(utf8Encode('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const long = utf8Encode('a'.repeat(1000));
  assert.equal(hex(sha256(long)), '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
});

test('utf-8 round trip and clipping never splits a letter', () => {
  const s = 'Гром 🔥 ok';
  assert.equal(utf8Decode(utf8Encode(s)), s);
  assert.equal(utf8Encode('Я').length, 2);
  assert.equal(utf8Decode(utf8Clip('ЯЯЯ', 5)), 'ЯЯ');
});

test('protobuf writer and reader agree', () => {
  const inner = new Writer().string(3, 'GrimMap').bytesField(2, Uint8Array.from([1, 2, 3]));
  const b = new Writer().uint(1, 300).fixed32(2, 0xffffffff).message(4, inner).uint(9, 2 ** 40).finish();
  const f = new Fields(b);
  assert.equal(f.uint(1), 300);
  assert.equal(f.uint(2), 0xffffffff);
  assert.equal(f.message(4)!.string(3), 'GrimMap');
  assert.deepEqual([...f.message(4)!.bytes(2)!], [1, 2, 3]);
  assert.equal(f.uint(9), 2 ** 40);
  // want_config_id is field 3 of ToRadio.
  assert.equal(new Fields(wantConfig(12345)).uint(3), 12345);
});

test('a broadcast packet has the documented layout', () => {
  const payload = Uint8Array.from([0x47, 1, 2]);
  const to = new Fields(sendPacket({ channel: 1, portnum: 256, payload, id: 77 }));
  const p = to.message(1)!;
  assert.equal(p.uint(2), 0xffffffff);
  assert.equal(p.uint(3), 1);
  assert.equal(p.uint(6), 77);
  const d = p.message(4)!;
  assert.equal(d.uint(1), 256);
  assert.deepEqual([...d.bytes(2)!], [0x47, 1, 2]);
});

test('squad channel admin message sets slot 1 as secondary with the squad key', () => {
  const psk = squadPsk(TEAM);
  assert.equal(psk.length, 32);
  assert.deepEqual(psk, squadPsk(TEAM));
  assert.notDeepEqual(psk, squadPsk('другой'));
  const p = new Fields(setSquadChannel(0x1234, psk, 5)).message(1)!;
  assert.equal(p.uint(2), 0x1234);
  const d = p.message(4)!;
  assert.equal(d.uint(1), 6);
  const ch = new Fields(d.bytes(2)!).message(33)!;
  assert.equal(ch.uint(1), 1);
  assert.equal(ch.uint(3), 2);
  assert.equal(ch.message(2)!.string(3), 'GrimMap');
  assert.deepEqual(ch.message(2)!.bytes(2), psk);
  assert.ok(hasSquadChannel([{ index: 1, role: 2, name: 'GrimMap', psk }], psk));
  assert.ok(!hasSquadChannel([{ index: 1, role: 0, name: '', psk: new Uint8Array(0) }], psk));
});

test('FromRadio: packets, node info, channels, config done', () => {
  const data = new Writer().uint(1, 256).bytesField(2, Uint8Array.from([9, 8]));
  const pkt = new Writer().fixed32(1, 0xa1b2c3d4).fixed32(2, 0xffffffff).uint(3, 1).message(4, data).fixed32(6, 42).uint(9, 1).uint(15, 3);
  const r = decodeFromRadio(new Writer().uint(1, 7).message(2, pkt).finish());
  assert.equal(r.type, 'packet');
  if (r.type === 'packet') {
    assert.equal(r.packet.from, 0xa1b2c3d4);
    assert.equal(r.packet.channel, 1);
    assert.equal(r.packet.portnum, 256);
    assert.deepEqual([...r.packet.payload], [9, 8]);
    assert.equal(r.packet.hops, 2);
  }
  const pos = new Writer().fixed32(1, Math.round(56.8270 * 1e7)).fixed32(2, Math.round(60.6165 * 1e7));
  const user = new Writer().string(1, '!a1b2c3d4').string(2, 'Гром').string(3, 'GR');
  const node = decodeFromRadio(new Writer().message(4, new Writer().uint(1, 99).message(2, user).message(3, pos)).finish());
  assert.equal(node.type, 'node');
  if (node.type === 'node') {
    assert.equal(node.node.longName, 'Гром');
    assert.ok(Math.abs(node.node.lat! - 56.827) < 1e-6);
  }
  // A negative latitude (southern hemisphere) survives sfixed32.
  const south = new Writer().fixed32(1, Math.round(-33.9 * 1e7) >>> 0).fixed32(2, Math.round(151.2 * 1e7));
  const sn = decodeFromRadio(new Writer().message(4, new Writer().uint(1, 5).message(3, south)).finish());
  if (sn.type === 'node') assert.ok(Math.abs(sn.node.lat! + 33.9) < 1e-6);
  assert.deepEqual(decodeFromRadio(new Writer().message(3, new Writer().uint(1, 1234)).finish()), { type: 'myInfo', nodeNum: 1234 });
  assert.deepEqual(decodeFromRadio(new Writer().uint(7, 55).finish()), { type: 'configComplete', nonce: 55 });
  const ch = decodeFromRadio(
    new Writer().message(10, new Writer().uint(1, 1).message(2, new Writer().string(3, 'GrimMap')).uint(3, 2)).finish()
  );
  assert.equal(ch.type === 'channel' && ch.channel.name, 'GrimMap');
  assert.equal(nodeIdText(0xa1b2c3d4), '!a1b2c3d4');
});

const pos = posEnvelope(
  TEAM,
  {
    uid: 'u1A2b3C4d5E6f7G8h9I0j1K2l3M4',
    callsign: 'Гром-1',
    role: 'mortar',
    status: 'dead',
    cmd: true,
    lat: 56.8270331,
    lng: 60.6165312,
    heading: 271,
    accuracy: 6,
  },
  1_762_700_000_123
);

test('a position fits one LoRa packet and comes back intact', () => {
  const b = encodeEnvelope(pos, TEAM);
  assert.ok(b.length <= 100, `${b.length} bytes`);
  const back = decodeEnvelope(b, TEAM);
  assert.deepEqual(back, pos);
  // Other squads' traffic is ignored.
  assert.equal(decodeEnvelope(b, 'other-team'), null);
  assert.notEqual(teamHash(TEAM), teamHash('other-team'));
});

test('chat, markers and votes round trip, long ones in fragments', () => {
  const chat = chatEnvelope(TEAM, { id: 'm1', uid: 'u1', callsign: 'Гром', text: 'Противник на севере, 3 человека у моста. '.repeat(6) }, 1000);
  const mark = markEnvelope(
    TEAM,
    {
      id: 'mk1',
      kind: 'arrow',
      label: '',
      lat: 56.8,
      lng: 60.6,
      createdBy: 'u1',
      createdByName: 'Гром',
      createdAt: 900,
      points: Array.from({ length: 12 }, (_, i) => ({ lat: 56.8 + i * 1e-4, lng: 60.6 })),
      color: '#FF4D4D',
    },
    2000
  );
  const vote = voteEnvelope(TEAM, { markId: 'mk1', uid: 'u2', vote: 'stale' }, 3000);
  const asm = new Reassembler();
  for (const e of [chat, mark, vote, pos]) {
    const frames = fragment(encodeEnvelope(e, TEAM), 0x1234 + e.t)!;
    assert.ok(frames.every((f) => f.length <= MAX_PAYLOAD));
    // Fragments may arrive out of order.
    let whole: Uint8Array | null = null;
    for (const f of [...frames].reverse()) whole = asm.push(7, f, 0) ?? whole;
    assert.deepEqual(decodeEnvelope(whole!, TEAM), e);
  }
  assert.ok(fragment(encodeEnvelope(chat, TEAM), 1)!.length > 1);
});

test('fragments: missing parts never complete, stale ones expire, oversize is refused', () => {
  const big = new Uint8Array(600).fill(1);
  big[0] = 0x47;
  const frames = fragment(big, 9)!;
  const asm = new Reassembler(1000);
  assert.equal(asm.push(1, frames[0], 0), null);
  assert.equal(asm.push(2, frames[1], 0), null); // another radio's part doesn't count
  assert.equal(asm.push(1, frames[1], 5000), null); // first part expired meanwhile
  assert.equal(fragment(new Uint8Array(MAX_PAYLOAD * (MAX_FRAGMENTS + 1)), 1), null);
  assert.equal(asm.push(1, Uint8Array.from([1, 2, 3]), 0), null);
});

test('base64 matches the standard encoding', async () => {
  const { fromBase64, toBase64 } = await import('../src/lib/base64.ts');
  for (const n of [0, 1, 2, 3, 4, 5, 64, 233]) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
    assert.equal(toBase64(b), Buffer.from(b).toString('base64'));
    assert.deepEqual(fromBase64(Buffer.from(b).toString('base64')), b);
  }
});

test('outbox paces packets, puts chat first and keeps only the latest position', async () => {
  const { RadioOutbox } = await import('../src/lib/lora.ts');
  const box = new RadioOutbox(1000);
  const p1 = { ...pos, t: 1 };
  const p2 = { ...pos, t: 2 };
  const chat = chatEnvelope(TEAM, { id: 'c', uid: 'u', callsign: 'Г', text: 'привет' }, 5);
  box.push(p1, [Uint8Array.from([1])]);
  box.push(p2, [Uint8Array.from([2])]);
  box.push(chat, [Uint8Array.from([3]), Uint8Array.from([4])]);
  assert.equal(box.size, 2);
  assert.deepEqual([...box.next(0)!], [3]);
  assert.equal(box.next(500), null);
  assert.deepEqual([...box.next(1000)!], [4]);
  assert.deepEqual([...box.next(2000)!], [2]);
  assert.equal(box.next(3000), null);
});

test('position rate backs off as the radio net grows, keeping the air under ~25%', async () => {
  const { radioPosIntervals } = await import('../src/lib/lora.ts');
  assert.equal(radioPosIntervals(1).minMs, 30_000);
  assert.equal(radioPosIntervals(0).minMs, 30_000);
  for (const n of [5, 10, 20, 40]) {
    const { minMs, heartbeatMs } = radioPosIntervals(n);
    // Everyone moving: airtime share of positions.
    const share = (n * 1.1 * 1.7) / (minMs / 1000);
    assert.ok(share <= 0.26, `${n}: ${share}`);
    assert.ok(heartbeatMs >= minMs * 3);
  }
  assert.ok(radioPosIntervals(20).minMs >= 140_000);
});
