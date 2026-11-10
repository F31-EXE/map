// Merges the per-region metadata files (<id>.json, downloaded from the release) into
// regions.json, the list the app reads. Usage: node index.mjs <dir> <out> <baseUrl>
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { OVERVIEW, REGIONS } from './regions.mjs';

const [dir, out, baseUrl] = process.argv.slice(2);
const order = [OVERVIEW, ...REGIONS].map((r) => r.id);
// Asset names on the release, one per line (written by the workflow).
const assetsFile = join(dir, 'assets.txt');
const assets = existsSync(assetsFile) ? new Set(readFileSync(assetsFile, 'utf8').split('\n').filter(Boolean)) : null;
const list = readdirSync(dir)
  .filter((f) => f.endsWith('.json') && f !== 'regions.json')
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
  .filter((r) => order.includes(r.id) && (!assets || assets.has(`${r.id}.pmtiles`)))
  .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  .map((r) => ({ ...r, url: `${baseUrl}/${r.id}.pmtiles` }));
writeFileSync(out, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), regions: list }, null, 1));
console.log(`${list.length} regions in ${out}`);
