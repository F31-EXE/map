import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_ROLE, ROLE_ORDER, ROLES, roleFrame, roleOf } from '../src/lib/roles.ts';

test('every role has a well-formed glyph and frame', () => {
  assert.deepEqual([...ROLE_ORDER].sort(), Object.keys(ROLES).sort());
  for (const id of ROLE_ORDER) {
    for (const d of [ROLES[id].path, roleFrame(id)]) {
      assert.match(d, /^[MLCZ0-9.\s-]+$/, id);
      assert.ok(!d.includes('NaN'), id);
      // Every coordinate stays inside the 24×24 box.
      for (const n of d.match(/-?\d*\.?\d+/g)!.map(Number)) assert.ok(n >= 0 && n <= 24, `${id}: ${n}`);
    }
  }
});

test('unknown roles fall back to the default; old ids still resolve', () => {
  assert.equal(roleOf('nope'), DEFAULT_ROLE);
  for (const old of ['commander', 'sergeant', 'rifleman', 'machinegunner', 'sniper', 'medic']) assert.equal(roleOf(old), old);
});
