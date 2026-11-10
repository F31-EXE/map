import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lowPower, powerText } from '../src/lib/power.ts';

test('battery text and low warning', () => {
  assert.equal(powerText({}), null);
  assert.equal(powerText({ battery: 45, radioBattery: 80 }), 'телефон 45 % · рация 80 %');
  assert.equal(powerText({ battery: 15, charging: true, radioBattery: 101 }), 'телефон 15 % ⚡ · рация от сети');
  assert.equal(lowPower({ battery: 15 }), true);
  assert.equal(lowPower({ battery: 15, charging: true }), false, 'charging is fine');
  assert.equal(lowPower({ battery: 60, radioBattery: 12 }), true);
  assert.equal(lowPower({ battery: 60, radioBattery: 101 }), false);
  assert.equal(lowPower({}), false);
});
