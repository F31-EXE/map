// Merges the per-region metadata files (<id>.json, downloaded from the release) into
// regions.json, the list the app reads. Usage: node index.mjs <dir> <out> <baseUrl>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { OVERVIEW, REGIONS } from './regions.mjs';

const [dir, out, baseUrl] = process.argv.slice(2);
const order = [OVERVIEW, ...REGIONS].map((r) => r.id);
const list = readdirSync(dir)
  .filter((f) => f.endsWith('.json') && f !== 'regions.json')
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
  .filter((r) => order.includes(r.id))
  .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  .map((r) => ({ ...r, url: `${baseUrl}/${r.id}.pmtiles` }));
writeFileSync(out, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), regions: list }, null, 1));
console.log(`${list.length} regions in ${out}`);
