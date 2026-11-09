import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inviteUrl, parseInvite } from '../src/lib/invite.ts';

test('round-trips squad and side invites', () => {
  assert.deepEqual(parseInvite(inviteUrl({ kind: 'team', code: 'K7QX2M' })), { kind: 'team', code: 'K7QX2M' });
  assert.deepEqual(parseInvite(inviteUrl({ kind: 'side', code: 'P4MZ8A' })), { kind: 'side', code: 'P4MZ8A' });
});

test('accepts the forms the OS may hand over', () => {
  assert.deepEqual(parseInvite('grimmap:///join?team=k7qx2m'), { kind: 'team', code: 'K7QX2M' });
  assert.deepEqual(parseInvite('  grimmap://join/?side=P4MZ8A&x=1 '), { kind: 'side', code: 'P4MZ8A' });
});

test('a bare code is a squad code', () => {
  assert.deepEqual(parseInvite('K7QX2M'), { kind: 'team', code: 'K7QX2M' });
});

test('rejects unrelated QR codes', () => {
  assert.equal(parseInvite('https://example.com/?team=K7QX2M'), null);
  assert.equal(parseInvite('grimmap://join?foo=bar'), null);
  assert.equal(parseInvite('hello world'), null);
});

test('game invites: tech, side into game, claiming a side', async () => {
  const { inviteUrl, parseInvite } = await import('../src/lib/invite.ts');
  for (const inv of [
    { kind: 'game', code: 'T3CH42' },
    { kind: 'gameside', code: 'S1DE42' },
    { kind: 'claim', code: 'ABCDEF123456', sideId: 'aBc123XyZ' },
  ] as const) {
    assert.deepEqual(parseInvite(inviteUrl(inv)), inv);
  }
});
