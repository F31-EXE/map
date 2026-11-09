import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The snail grid math lives in the map page (map.js, between the snail markers).
const src = readFileSync(new URL('../src/map/web/map.js', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('// snail:begin'), src.indexOf('// snail:end'));
type Cell = { col: number; row: number; name: string; s1: number; s2: number };
const snailCell = new Function(`${block}; return snailCell;`)() as (
  e: number,
  n: number,
  origin: { e: number; n: number } | null
) => Cell;

const O = { e: 0, n: 500 };
const ninth = 500 / 3;
const at = (col: number, row: number) => snailCell(col * ninth + ninth / 2, 500 - row * ninth - ninth / 2, O).s1;

test('first level follows the snail: 1 2 3 / 8 9 4 / 7 6 5', () => {
  assert.deepEqual(
    [0, 1, 2].map((r) => [0, 1, 2].map((c) => at(c, r))),
    [
      [1, 2, 3],
      [8, 9, 4],
      [7, 6, 5],
    ]
  );
});

test('second level and square names', () => {
  // Top-left ninth of А1, then its top-middle part.
  const c = snailCell(500 / 9 * 1.5, 500 - (500 / 9) * 0.5, O);
  assert.deepEqual(c, { col: 0, row: 0, name: 'А1', s1: 1, s2: 2 });
  assert.equal(snailCell(250, 250, O).s2, 9);
  // Columns are letters going east, rows numbers going south.
  assert.equal(snailCell(1250, -760, O).name, 'В3');
  assert.equal(snailCell(1250, -1100, O).name, 'В4');
});

test('without a squad origin, squares count from each 5 km block', () => {
  const c = snailCell(437_250, 6_301_200, null);
  assert.equal(c.name, 'Д8');
  // Same answer on every phone: depends only on the point.
  assert.deepEqual(snailCell(437_250, 6_301_200, null), c);
});
