/**
 * Tile math for offline map areas. Mirrors the base layers in src/map/web/map.js
 * (keep the URL templates in sync). Yandex uses EPSG:3395 (ellipsoidal Mercator),
 * everything else EPSG:3857, and the tile rows differ between the two.
 */

export type TileLayerDef = {
  title: string;
  crs: '3395' | '3857';
  /** Highest zoom the server has tiles for. */
  maxZoom: number;
  /** One or more tile URL templates drawn on top of each other. */
  urls: string[];
  /** Rough average tile size, for the download estimate. */
  avgKb: number;
};

const YA_SAT = 'https://core-sat.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}&scale=1&lang=ru_RU';
const YA_SKL = 'https://core-renderer-tiles.maps.yandex.net/tiles?l=skl&x={x}&y={y}&z={z}&scale=1&lang=ru_RU';
const YA_MAP = 'https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU';

export const TILE_LAYERS: Record<string, TileLayerDef> = {
  'yandex-sat': { title: 'Спутник Яндекс', crs: '3395', maxZoom: 19, urls: [YA_SAT], avgKb: 25 },
  'yandex-hybrid': { title: 'Гибрид Яндекс', crs: '3395', maxZoom: 19, urls: [YA_SAT, YA_SKL], avgKb: 35 },
  'yandex-map': { title: 'Схема Яндекс', crs: '3395', maxZoom: 19, urls: [YA_MAP], avgKb: 12 },
  'esri-sat': {
    title: 'Спутник Esri',
    crs: '3857',
    maxZoom: 19,
    urls: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    avgKb: 25,
  },
  osm: { title: 'OpenStreetMap', crs: '3857', maxZoom: 19, urls: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], avgKb: 12 },
  topo: { title: 'OpenTopoMap', crs: '3857', maxZoom: 17, urls: ['https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'], avgKb: 20 },
};

export type Bounds = { south: number; west: number; north: number; east: number };

const E = 0.0818191908426; // WGS84 eccentricity, as in Leaflet's EPSG:3395

/** Tile column/row containing a point at zoom z. */
export function tileXY(lat: number, lng: number, z: number, crs: '3395' | '3857'): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const phi = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  let merc = Math.log(Math.tan(Math.PI / 4 + phi / 2));
  if (crs === '3395') {
    const es = E * Math.sin(phi);
    merc += (E / 2) * Math.log((1 - es) / (1 + es));
  }
  const y = Math.floor(((1 - merc / Math.PI) / 2) * n);
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, v));
  return { x: clamp(x), y: clamp(y) };
}

/** Tile ranges covering the bounds, per zoom. */
export function tileRanges(b: Bounds, minZoom: number, maxZoom: number, crs: '3395' | '3857') {
  const out: { z: number; x0: number; x1: number; y0: number; y1: number }[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const nw = tileXY(b.north, b.west, z, crs);
    const se = tileXY(b.south, b.east, z, crs);
    out.push({ z, x0: nw.x, x1: se.x, y0: nw.y, y1: se.y });
  }
  return out;
}

export function countTiles(b: Bounds, minZoom: number, maxZoom: number, crs: '3395' | '3857'): number {
  return tileRanges(b, minZoom, maxZoom, crs).reduce((n, r) => n + (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1), 0);
}

/** Every tile of the area, coarse zooms first (so a cut-short download is still useful). */
export function* tilesOf(b: Bounds, minZoom: number, maxZoom: number, crs: '3395' | '3857') {
  for (const r of tileRanges(b, minZoom, maxZoom, crs)) {
    for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) yield { z: r.z, x, y };
  }
}

export function tileUrl(template: string, t: { z: number; x: number; y: number }): string {
  const s = 'abc'[(t.x + t.y) % 3];
  return template.replace('{s}', s).replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
}

/** File extension for a template: tiles are saved as files the WebView can load. */
export function tileExt(template: string): 'png' | 'jpg' {
  return /\.png|l=skl|l=map/.test(template) ? 'png' : 'jpg';
}

/**
 * Splits an area into parts of at most `maxTiles` tiles each (halving along the longer
 * side), so a big region downloads piece by piece. Parts share their edges.
 */
export function splitToFit(
  b: Bounds,
  minZoom: number,
  maxZoom: number,
  crs: '3395' | '3857',
  maxTiles: number,
  layers = 1
): Bounds[] {
  if (countTiles(b, minZoom, maxZoom, crs) * layers <= maxTiles) return [b];
  const tall = b.north - b.south > (b.east - b.west) * Math.cos((((b.north + b.south) / 2) * Math.PI) / 180);
  // A single tile column/row can't be split further.
  if (Math.max(b.north - b.south, b.east - b.west) < 1e-6) return [b];
  const halves: Bounds[] = tall
    ? [
        { ...b, south: (b.south + b.north) / 2 },
        { ...b, north: (b.south + b.north) / 2 },
      ]
    : [
        { ...b, east: (b.west + b.east) / 2 },
        { ...b, west: (b.west + b.east) / 2 },
      ];
  return halves.flatMap((h) => splitToFit(h, minZoom, maxZoom, crs, maxTiles, layers));
}
