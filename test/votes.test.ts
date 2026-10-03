import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isVotedOut, voteThreshold } from '../src/lib/markerKinds.ts';

test('three votes, or the whole squad when smaller', () => {
  assert.equal(voteThreshold(10), 3);
  assert.equal(voteThreshold(2), 2);
  assert.equal(voteThreshold(0), 1);
});

test('hidden once either vote reaches the threshold', () => {
  assert.equal(isVotedOut({ staleVotes: ['a', 'b'] }, 5), false);
  assert.equal(isVotedOut({ staleVotes: ['a', 'b', 'c'] }, 5), true);
  assert.equal(isVotedOut({ doneVotes: ['a', 'b'] }, 2), true);
  assert.equal(isVotedOut({}, 5), false);
});
