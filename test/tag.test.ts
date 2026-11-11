import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cleanTag, withTag } from '../src/lib/tag.ts';

test('team tag', () => {
  assert.equal(cleanTag(' [GRIM] '), 'GRIM');
  assert.equal(cleanTag('ВОЛКИ1'), 'ВОЛКИ');
  assert.equal(cleanTag('A B'), 'AB');
  assert.equal(withTag('Гром', 'GRIM'), '[GRIM] Гром');
  assert.equal(withTag('Гром', ''), 'Гром');
  assert.equal(withTag('Гром', null), 'Гром');
});
