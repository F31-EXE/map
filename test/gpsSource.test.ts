import assert from 'node:assert/strict';
import { test } from 'node:test';

import { gpsSrcText, pickGps, radioPollMs, RADIO_ACCURACY_GUESS } from '../src/lib/gpsSource.ts';
import {
  decodeFromRadio,
  decodePosition,
  decodePositionConfig,
  FAST_GPS_SECS,
  patchVarints,
  POS_FLAG_DOP,
  POS_FLAG_SATS,
  radioAccuracy,
  radioGpsFast,
  radioHasGps,
  setPositionConfig,
} from '../src/lib/meshtastic.ts';
import { Fields, Writer } from '../src/lib/protobuf.ts';

const NOW = 1_000_000_000;
const phone = (acc: number | null, age = 1000) => ({ lat: 56.8, lng: 60.6, accuracy: acc, timestamp: NOW - age });
const radio = (acc: number | null, age = 2000) => ({ lat: 56.8001, lng: 60.6, accuracy: acc, at: NOW - age });

test('phone mode: phone while it has a fix, the radio only as a fallback', () => {
  assert.equal(pickGps('phone', phone(30), radio(2), NOW, 20_000), 'phone');
  assert.equal(pickGps('phone', phone(30, 90_000), radio(2), NOW, 20_000), 'radio');
  assert.equal(pickGps('phone', null, radio(2, 5 * 60_000), NOW, 20_000), 'radio');
  assert.equal(pickGps('phone', null, null, NOW, 20_000), null);
});

test('radio mode: the radio while its fix is live, else the phone', () => {
  assert.equal(pickGps('radio', phone(3), radio(10), NOW, 20_000), 'radio');
  assert.equal(pickGps('radio', phone(3), radio(10, 25_000), NOW, 20_000), 'phone');
  assert.equal(pickGps('radio', null, radio(10, 25_000), NOW, 20_000), 'radio');
});

test('auto: the clearly more accurate one, without flipping on small differences', () => {
  assert.equal(pickGps('auto', phone(20), radio(4), NOW, 20_000), 'radio');
  assert.equal(pickGps('auto', phone(4), radio(20), NOW, 20_000), 'phone');
  // Close: stays with what it had.
  assert.equal(pickGps('auto', phone(5), radio(4.5), NOW, 20_000, 'phone'), 'phone');
  assert.equal(pickGps('auto', phone(4.5), radio(5), NOW, 20_000, 'radio'), 'radio');
  // A radio without DOP counts as RADIO_ACCURACY_GUESS metres.
  assert.equal(pickGps('auto', phone(RADIO_ACCURACY_GUESS * 2), radio(null), NOW, 20_000), 'radio');
  assert.equal(pickGps('auto', phone(5), radio(null), NOW, 20_000), 'phone');
  // Only one is live.
  assert.equal(pickGps('auto', phone(3, 30_000), radio(9), NOW, 20_000), 'radio');
  assert.equal(pickGps('auto', phone(30), radio(2, 60_000), NOW, 20_000), 'phone');
});

test('poll interval grows with the node list', () => {
  assert.equal(radioPollMs(0), 5_000);
  assert.equal(radioPollMs(100), 8_000);
  assert.equal(radioPollMs(1000), 30_000);
});

test('source text for member cards', () => {
  assert.equal(gpsSrcText('radio', 3.6), 'GPS рации ±4 м');
  assert.equal(gpsSrcText('phone'), 'GPS телефона');
  assert.equal(gpsSrcText(null), null);
});

const position = (o: { lat: number; lng: number; time?: number; src?: number; pdop?: number; hdop?: number; acc?: number; sats?: number }) => {
  const w = new Writer().fixed32(1, Math.round(o.lat * 1e7)).fixed32(2, Math.round(o.lng * 1e7));
  if (o.time) w.fixed32(4, o.time);
  if (o.src) w.uint(5, o.src);
  if (o.pdop) w.uint(11, o.pdop);
  if (o.hdop) w.uint(12, o.hdop);
  if (o.acc) w.uint(14, o.acc);
  if (o.sats) w.uint(19, o.sats);
  return w;
};

test('positions carry time, source, DOP and satellites', () => {
  const p = decodePosition(position({ lat: 56.638184, lng: 60.668019, time: 1_700_000_000, src: 2, pdop: 180, hdop: 120, acc: 2500, sats: 9 }).finish());
  assert.ok(p);
  assert.ok(Math.abs(p.lat - 56.638184) < 1e-6 && Math.abs(p.lng - 60.668019) < 1e-6);
  assert.equal(p.time, 1_700_000_000);
  assert.equal(p.source, 2);
  assert.equal(p.sats, 9);
  // HDOP 1.2 × 2.5 m.
  assert.equal(radioAccuracy(p), 3);
  // PDOP alone, no receiver constant: × 5 m.
  assert.equal(radioAccuracy({ pdop: 200, hdop: 0, gpsAccuracy: 0 }), 10);
  assert.equal(radioAccuracy({ pdop: 0, hdop: 0, gpsAccuracy: 3000 }), null);
  // Lost fix = 0, 0.
  assert.equal(decodePosition(position({ lat: 0, lng: 0 }).finish()), null);
});

test('own node in the node list keeps its full position', () => {
  const node = new Writer().uint(1, 0x1234).message(3, position({ lat: 56.8, lng: 60.6, time: 42, src: 2 })).uint(5, 99);
  const msg = decodeFromRadio(new Writer().message(4, node).finish());
  assert.equal(msg.type, 'node');
  if (msg.type !== 'node') return;
  assert.equal(msg.node.pos?.time, 42);
  assert.equal(msg.node.pos?.source, 2);
});

test('position config: read, judged, patched without losing unknown fields', () => {
  // broadcast 900 s, update interval 120 s, flags ALTITUDE|ALTITUDE_MSL, gps_mode ENABLED, a field 99 from the future.
  const raw = new Writer().uint(1, 900).uint(5, 120).uint(7, 3).uint(13, 1).string(99, 'keep').finish();
  const msg = decodeFromRadio(new Writer().message(5, new Writer().bytesField(2, raw)).finish());
  assert.equal(msg.type, 'positionConfig');
  if (msg.type !== 'positionConfig') return;
  const c = msg.config;
  assert.equal(c.updateInterval, 120);
  assert.equal(radioHasGps(c), true);
  assert.equal(radioGpsFast(c), false);

  const patched = patchVarints(raw, { 5: FAST_GPS_SECS, 7: c.flags | POS_FLAG_DOP | POS_FLAG_SATS });
  const p = decodePositionConfig(patched);
  assert.equal(p.broadcastSecs, 900);
  assert.equal(p.updateInterval, FAST_GPS_SECS);
  assert.equal(p.flags, 3 | POS_FLAG_DOP | POS_FLAG_SATS);
  assert.equal(p.gpsMode, 1);
  assert.equal(new Fields(patched).string(99), 'keep');
  assert.equal(radioGpsFast(p), true);

  // No GPS: gps_mode NOT_PRESENT, or old firmware with gps_enabled off, or a fixed position.
  assert.equal(radioHasGps(decodePositionConfig(new Writer().uint(13, 2).finish())), false);
  assert.equal(radioHasGps(decodePositionConfig(new Writer().uint(4, 1).finish())), true);
  assert.equal(radioHasGps(decodePositionConfig(new Writer().uint(3, 1).uint(13, 1).finish())), false);
  assert.equal(radioHasGps(null), null);
});

test('set_config goes to our own radio as an admin message', () => {
  const raw = new Writer().uint(5, 5).finish();
  const bytes = setPositionConfig(0xabcd, raw, 7);
  const packet = new Fields(bytes).message(1)!;
  assert.equal(packet.uint(2), 0xabcd);
  const data = packet.message(4)!;
  assert.equal(data.uint(1), 6);
  const admin = new Fields(data.bytes(2)!);
  const cfg = admin.message(34)!;
  assert.deepEqual([...cfg.bytes(2)!], [...raw]);
});
