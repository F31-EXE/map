import assert from 'node:assert/strict';
import { test } from 'node:test';

import { frame, FrameParser } from '../src/lib/serialFrames.ts';

test('serial frames: round trip, split chunks, log text in between', () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array(300).fill(7);
  const text = new TextEncoder().encode('INFO | radio booted \x94 not a frame\n');
  const stream = new Uint8Array([...text, ...frame(a), ...text, ...frame(b)]);
  const p = new FrameParser();
  const got: Uint8Array[] = [];
  // Feed in awkward pieces, including a split right between 0x94 and 0xC3.
  for (let i = 0; i < stream.length; i += 5) got.push(...p.push(stream.slice(i, i + 5)));
  assert.equal(got.length, 2);
  assert.deepEqual([...got[0]], [...a]);
  assert.deepEqual([...got[1]], [...b]);
});

test('serial frames: a bogus header with a huge length is skipped', () => {
  const p = new FrameParser();
  const junk = new Uint8Array([0x94, 0xc3, 0xff, 0xff]);
  const out = p.push(new Uint8Array([...junk, ...frame(new Uint8Array([9]))]));
  assert.equal(out.length, 1);
  assert.deepEqual([...out[0]], [9]);
});
