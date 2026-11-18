import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  beginEdit,
  commitEdit,
  decodeFromRadio,
  setChannelRaw,
  setOwner,
  trackerSquadSettings,
  withPositionPrecision,
} from '../src/lib/meshtastic.ts';
import { Fields, utf8Encode, Writer } from '../src/lib/protobuf.ts';
import { canSeeTracker, clipName, parseNodeId, shortFrom, shouldRelay, trackerFix, trackerId } from '../src/lib/trackers.ts';

const NOW = 2_000_000_000_000;

test('node ids: hex like Meshtastic, or decimal', () => {
  assert.equal(trackerId(0xa1b2c3d4), 'a1b2c3d4');
  assert.equal(trackerId(0x12), '00000012');
  assert.equal(parseNodeId('!a1b2c3d4'), 0xa1b2c3d4);
  assert.equal(parseNodeId(' A1B2C3D4 '), 0xa1b2c3d4);
  assert.equal(parseNodeId('2712847316'), 2712847316);
  assert.equal(parseNodeId('!a1b2'), null);
  assert.equal(parseNodeId('0'), null);
});

test('who sees a tracker', () => {
  const all = { vis: 'all' as const, viewers: [] };
  const cmd = { vis: 'commanders' as const, viewers: ['bob'] };
  const chosen = { vis: 'chosen' as const, viewers: ['bob'] };
  assert.equal(canSeeTracker(all, 'ann', false), true);
  assert.equal(canSeeTracker(cmd, 'bob', false), false);
  assert.equal(canSeeTracker(cmd, 'ann', true), true);
  assert.equal(canSeeTracker(chosen, 'bob', false), true);
  assert.equal(canSeeTracker(chosen, 'ann', false), false);
  assert.equal(canSeeTracker(chosen, 'ann', true), true);
});

test('the newer fix wins; relay at most once a minute and only when newer', () => {
  const server = { lat: 1, lng: 2, at: NOW - 120_000 };
  const heard = { lat: 1.1, lng: 2.1, at: NOW - 1000 };
  assert.deepEqual(trackerFix(server, heard), heard);
  assert.deepEqual(trackerFix({ ...server, at: NOW }, heard), { lat: 1, lng: 2, at: NOW });
  assert.deepEqual(trackerFix({ lat: null, lng: null, at: null }, heard), heard);
  assert.equal(trackerFix({ lat: null, lng: null, at: null }, null), null);

  assert.equal(shouldRelay(server, heard, null, NOW), true);
  assert.equal(shouldRelay(server, heard, NOW - 30_000, NOW), false);
  assert.equal(shouldRelay({ at: NOW - 30_000 }, heard, null, NOW), false);
  assert.equal(shouldRelay({ at: null }, heard, null, NOW), true);
  assert.equal(shouldRelay({ at: null }, { ...heard, at: NOW - 11 * 60_000 }, null, NOW), false);
  assert.equal(shouldRelay(server, null, null, NOW), false);
});

test('names fit the radio: 24 bytes long, 4 short', () => {
  assert.equal(clipName('Союзники-1'), 'Союзники-1');
  assert.ok(utf8Encode(clipName('Очень длинное название подразделения')).length <= 24);
  assert.equal(clipName('Очень длинное название подразделения'), 'Очень длинно');
  assert.equal(shortFrom('Союзники-1'), 'SOY1');
  assert.equal(shortFrom('Медведь 12'), 'ME12');
  assert.equal(shortFrom('Гром'), 'GROM');
  assert.equal(shortFrom('Alpha 3'), 'ALP3');
  assert.equal(shortFrom('---'), 'TRK');
});

test('tracker set-up messages: names, channels, edit transaction', () => {
  const owner = new Fields(new Fields(new Fields(setOwner(7, 'Союзники-1', 'SOY1', 1)).message(1)!.message(4)!.bytes(2)!).bytes(32)!);
  assert.equal(owner.string(2), 'Союзники-1');
  assert.equal(owner.string(3), 'SOY1');
  const adminOf = (b: Uint8Array) => new Fields(new Fields(b).message(1)!.message(4)!.bytes(2)!);
  assert.equal(adminOf(beginEdit(7, 2)).uint(64), 1);
  assert.equal(adminOf(commitEdit(7, 3)).uint(65), 1);

  // The primary channel keeps its key and name but stops carrying the position.
  const primary = new Writer().bytesField(2, new Uint8Array([1])).string(3, 'LongFast').message(7, new Writer().uint(1, 13).bool(2, true)).finish();
  const quiet = new Fields(withPositionPrecision(primary, 0));
  assert.equal(quiet.string(3), 'LongFast');
  assert.deepEqual([...quiet.bytes(2)!], [1]);
  const mod = new Fields(quiet.bytes(7)!);
  assert.equal(mod.uint(1), 0);
  assert.equal(mod.uint(2), 1);

  // Settings without module_settings get them.
  assert.equal(new Fields(new Fields(withPositionPrecision(new Uint8Array(0), 32)).bytes(7)!).uint(1), 32);

  const psk = new Uint8Array(32).fill(9);
  const squad = new Fields(trackerSquadSettings(psk));
  assert.equal(squad.string(3), 'GrimMap');
  assert.equal(new Fields(squad.bytes(7)!).uint(1), 32);
  const ch = new Fields(adminOf(setChannelRaw(7, 1, 2, trackerSquadSettings(psk), 4)).bytes(33)!);
  assert.equal(ch.uint(1), 1);
  assert.equal(ch.uint(3), 2);
});

test('channel settings arrive raw so they can be written back', () => {
  const settings = new Writer().bytesField(2, new Uint8Array([1])).string(3, 'LongFast').finish();
  const msg = decodeFromRadio(new Writer().message(10, new Writer().uint(1, 0).bytesField(2, settings).uint(3, 1)).finish());
  assert.equal(msg.type, 'channel');
  if (msg.type !== 'channel') return;
  assert.deepEqual([...(msg.channel.raw ?? [])], [...settings]);
});
