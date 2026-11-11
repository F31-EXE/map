import assert from 'node:assert/strict';
import { test } from 'node:test';

import { plural, sayDistance, sayHint, sayTurn, VoiceCoach } from '../src/lib/voice.ts';

test('Russian numbers read naturally', () => {
  assert.equal(plural(1, 'метр', 'метра', 'метров'), 'метр');
  assert.equal(plural(22, 'метр', 'метра', 'метров'), 'метра');
  assert.equal(plural(12, 'метр', 'метра', 'метров'), 'метров');
  assert.equal(plural(111, 'метр', 'метра', 'метров'), 'метров');
  assert.equal(sayDistance(123), '120 метров');
  assert.equal(sayDistance(42), '40 метров');
  assert.equal(sayDistance(2), '5 метров');
  assert.equal(sayDistance(1240), '1 километр 200 метров');
  assert.equal(sayDistance(3020), '3 километра');
  assert.equal(sayTurn(null), null);
  assert.equal(sayTurn(10), 'прямо');
  assert.equal(sayTurn(-42), 'левее 40 градусов');
  assert.equal(sayTurn(21), 'правее 20 градусов');
  assert.equal(sayTurn(170), 'цель позади');
  assert.equal(sayHint(200, 61), 'правее 60 градусов, 200 метров');
});

test('coach speaks on new targets, milestones, turning away, and once a minute', () => {
  const c = new VoiceCoach();
  const t0 = 1_000_000;
  assert.equal(c.update({ target: 'Склад', distance: 260, turn: 0, now: t0 }), 'Склад. прямо, 260 метров');
  assert.equal(c.update({ target: 'Склад', distance: 250, turn: 5, now: t0 + 3000 }), null);
  // Past 200 m.
  assert.equal(c.update({ target: 'Склад', distance: 195, turn: 0, now: t0 + 20_000 }), 'прямо, 200 метров');
  assert.equal(c.update({ target: 'Склад', distance: 190, turn: 0, now: t0 + 25_000 }), null);
  // Turned away, but too soon after the last phrase.
  assert.equal(c.update({ target: 'Склад', distance: 185, turn: 60, now: t0 + 30_000 }), null);
  assert.equal(c.update({ target: 'Склад', distance: 185, turn: 60, now: t0 + 41_000 }), 'правее 60 градусов, 190 метров');
  // Quiet walking: once a minute.
  assert.equal(c.update({ target: 'Склад', distance: 150, turn: 0, now: t0 + 90_000 }), null);
  assert.equal(c.update({ target: 'Склад', distance: 140, turn: 0, now: t0 + 101_000 }), 'прямо, 140 метров');
  // Next route point.
  assert.equal(c.update({ target: 'Точка 2 из 3', distance: 80, turn: -20, now: t0 + 102_000 }), 'Точка 2 из 3. левее 20 градусов, 80 метров');
});
