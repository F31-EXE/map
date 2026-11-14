import assert from 'node:assert/strict';
import { test } from 'node:test';

import { looksLikeMeshtastic, MT_SERVICE } from '../src/lib/meshtastic.ts';

test('a radio is recognised by its service or its firmware name', () => {
  assert.ok(looksLikeMeshtastic(null, [MT_SERVICE.toUpperCase()]));
  assert.ok(looksLikeMeshtastic('Meshtastic_1a2b', null));
  assert.ok(looksLikeMeshtastic('GRIM_9f0c', []));
  assert.ok(looksLikeMeshtastic('Heltec V3', null));
  assert.ok(looksLikeMeshtastic('T114', null));
});

test('other devices are not', () => {
  assert.ok(!looksLikeMeshtastic('Mi Band 7', ['0000fee0-0000-1000-8000-00805f9b34fb']));
  assert.ok(!looksLikeMeshtastic('JBL Flip 5', null));
  assert.ok(!looksLikeMeshtastic('', null));
  assert.ok(!looksLikeMeshtastic(null, null));
});
