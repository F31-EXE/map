// Plans an offline-regions build: picks the newest Protomaps planet build and looks up
// each region's bounding box with Nominatim (one request a second, per its usage policy).
// Prints a GitHub Actions matrix to $GITHUB_OUTPUT. Usage: node plan.mjs [all|id,id,...]
import { appendFileSync } from 'node:fs';

import { OVERVIEW, REGIONS } from './regions.mjs';

const UA = 'GrimMap offline region builder (https://github.com/F31-EXE/map)';
const PAD = 0.15; // degrees around each region, so maps near the border keep going
const MAX_ZOOM = 15; // Protomaps basemap tiles stop at 15; the app overzooms

const wanted = (process.argv[2] || 'all').trim();
const ids = wanted === 'all' ? null : new Set(wanted.split(',').map((s) => s.trim()).filter(Boolean));

async function latestBuild() {
  for (let back = 0; back < 14; back++) {
    const d = new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '');
    const url = `https://build.protomaps.com/${d}.pmtiles`;
    const r = await fetch(url, { method: 'HEAD' });
    if (r.ok) return { url, date: d };
  }
  throw new Error('No Protomaps build found in the last two weeks');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lookup(region) {
  const q = new URLSearchParams({ q: region.q ?? region.name, countrycodes: 'ru', featureType: 'state', format: 'jsonv2', limit: '1' });
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru' } });
  if (!r.ok) throw new Error(`Nominatim ${r.status} for ${region.name}`);
  const [hit] = await r.json();
  if (!hit) throw new Error(`Nominatim found nothing for ${region.name}`);
  const [s, n, w, e] = hit.boundingbox.map(Number);
  if (e - w > 90 || n - s > 40) throw new Error(`Suspicious bbox for ${region.name}: ${hit.boundingbox}`);
  console.log(`${region.id}: ${hit.display_name} → [${w}, ${s}, ${e}, ${n}]`);
  return [w, s, e, n];
}

const round = (x) => Math.round(x * 1000) / 1000;
const pad = ([w, s, e, n]) => [round(Math.max(-180, w - PAD)), round(Math.max(-85, s - PAD)), round(Math.min(180, e + PAD)), round(Math.min(85, n + PAD))];

const build = await latestBuild();
console.log('Protomaps build', build.url);
const matrix = [];
for (const region of [OVERVIEW, ...REGIONS]) {
  if (ids && !ids.has(region.id)) continue;
  let bbox = region.bbox;
  if (!bbox) {
    bbox = await lookup(region);
    await sleep(1100);
  }
  matrix.push({ id: region.id, name: region.name, bbox: pad(bbox).join(','), maxzoom: region.maxzoom ?? MAX_ZOOM });
}
if (!matrix.length) throw new Error(`No regions match "${wanted}"`);
const out = process.env.GITHUB_OUTPUT;
if (out) {
  appendFileSync(out, `matrix=${JSON.stringify(matrix)}\n`);
  appendFileSync(out, `source=${build.url}\n`);
  appendFileSync(out, `date=${build.date}\n`);
} else {
  console.log(JSON.stringify(matrix, null, 1));
}
