import assert from 'node:assert/strict';
import { test } from 'node:test';

import { countTiles, splitToFit, tileExt, tileUrl, tileXY, tilesOf, TILE_LAYERS } from '../src/lib/tiles.ts';

test('3857 tiles match the standard slippy-map numbering', () => {
  // Moscow, Red Square, zoom 15 — the usual OSM tile.
  assert.deepEqual(tileXY(55.7539, 37.6208, 15, '3857'), { x: 19808, y: 10243 });
  assert.deepEqual(tileXY(0, 0, 1, '3857'), { x: 1, y: 1 });
});

test('Yandex (3395) rows sit lower than 3857 rows at the same latitude', () => {
  const a = tileXY(56.8, 60.7, 17, '3857');
  const b = tileXY(56.8, 60.7, 17, '3395');
  assert.equal(a.x, b.x);
  assert.ok(b.y > a.y, 'ellipsoidal Mercator puts the same latitude further south');
  // Same point, zoom 0: one tile.
  assert.deepEqual(tileXY(56.8, 60.7, 0, '3395'), { x: 0, y: 0 });
});

test('area tiles: count matches the enumeration, coarse zooms first', () => {
  const b = { south: 56.80, west: 60.70, north: 56.82, east: 60.73 };
  const list = [...tilesOf(b, 12, 16, '3395')];
  assert.equal(list.length, countTiles(b, 12, 16, '3395'));
  assert.equal(list[0].z, 12);
  assert.equal(list[list.length - 1].z, 16);
});

test('urls and extensions', () => {
  assert.equal(tileUrl(TILE_LAYERS.osm.urls[0], { z: 3, x: 4, y: 5 }), 'https://tile.openstreetmap.org/3/4/5.png');
  assert.match(tileUrl(TILE_LAYERS.topo.urls[0], { z: 1, x: 0, y: 1 }), /^https:\/\/[abc]\.tile\.opentopomap\.org\/1\/0\/1\.png$/);
  assert.equal(tileExt(TILE_LAYERS['yandex-sat'].urls[0]), 'jpg');
  assert.equal(tileExt(TILE_LAYERS['yandex-hybrid'].urls[1]), 'png');
});

test('a big area splits into parts that each fit and together cover it', () => {
  const b = { south: 56.7, west: 60.5, north: 56.9, east: 60.9 };
  const total = countTiles(b, 12, 18, '3395');
  assert.ok(total > 20_000);
  const parts = splitToFit(b, 12, 18, '3395', 20_000);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(countTiles(p, 12, 18, '3395') <= 20_000);
  // Coverage: the parts' tiles at the top zoom add up to at least the whole area's.
  const sum = parts.reduce((n, p) => n + countTiles(p, 18, 18, '3395'), 0);
  assert.ok(sum >= countTiles(b, 18, 18, '3395'));
  assert.deepEqual(splitToFit(b, 12, 13, '3395', 20_000), [b], 'small enough stays whole');
});
