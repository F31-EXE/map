/**
 * Control zone with a moving hot zone (as in WARDOGS): a big circle set by a commander,
 * and a smaller hot circle inside it that relocates every `every` ms. The positions come
 * from `seed`, so every phone computes the same circle without talking to the server,
 * and the mesh only has to carry the settings once.
 *
 * Each period: the hot zone holds, then its next spot is shown (warn), then it slides
 * there (move). Duplicated as `hz*` functions in src/map/web/map.js — keep them in sync.
 */
import type { LatLng } from './types';

export type HotZone = {
  /** Control zone radius, m. */
  r: number;
  /** Hot zone radius, m. */
  hot: number;
  /** Time between relocations, ms. */
  every: number;
  /** The schedule's origin, ms. */
  start: number;
  /** Picks the sequence of spots. */
  seed: number;
};

export type HotState = LatLng & {
  /** Where the hot zone goes next, once revealed. */
  next: LatLng | null;
  phase: 'hold' | 'warn' | 'move';
  /** End of the current phase. */
  at: number;
  /** Period number (changes after each relocation). */
  k: number;
};

export const ZONE_RADII = [150, 250, 400, 600, 1000];
export const HOT_RADII = [30, 50, 75, 100, 150];
export const ZONE_EVERY_MIN = [3, 5, 10, 15, 20];

const M_PER_DEG = 111_320;

export function validZone(z: unknown): z is HotZone {
  if (!z || typeof z !== 'object') return false;
  const o = z as Record<string, unknown>;
  const n = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  return (
    n(o.r) &&
    n(o.hot) &&
    n(o.every) &&
    n(o.start) &&
    n(o.seed) &&
    (o.r as number) >= 50 &&
    (o.r as number) <= 5000 &&
    (o.hot as number) >= 10 &&
    (o.hot as number) <= (o.r as number) &&
    (o.every as number) >= 60_000 &&
    (o.every as number) <= 3_600_000
  );
}

export function newZone(r = 400, hot = 75, everyMin = 10, now = Date.now()): HotZone {
  return { r, hot: Math.min(hot, r / 2), every: everyMin * 60_000, start: now, seed: Math.floor(Math.random() * 2 ** 31) };
}

/** Uniform in [0, 1), from the seed, period and draw number. */
export function hzRand(seed: number, k: number, i: number): number {
  let h = (seed ^ Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** Hot zone center in period k: uniform over the area where it stays inside the control zone. */
export function hzPoint(center: LatLng, z: HotZone, k: number): LatLng {
  const room = Math.max(0, z.r - z.hot);
  const d = Math.sqrt(hzRand(z.seed, k, 0)) * room;
  const a = hzRand(z.seed, k, 1) * 2 * Math.PI;
  return {
    lat: center.lat + (d * Math.cos(a)) / M_PER_DEG,
    lng: center.lng + (d * Math.sin(a)) / (M_PER_DEG * Math.cos((center.lat * Math.PI) / 180)),
  };
}

/** Slide and warning lengths for a period. */
export function hzTiming(every: number): { move: number; warn: number } {
  return {
    move: Math.min(90_000, Math.max(30_000, every * 0.2)),
    warn: Math.min(180_000, Math.max(60_000, every * 0.3)),
  };
}

export function hotState(center: LatLng, z: HotZone, now: number): HotState {
  const t = Math.max(0, now - z.start);
  const k = Math.floor(t / z.every);
  const base = z.start + k * z.every;
  const ph = t - k * z.every;
  const { move, warn } = hzTiming(z.every);
  const moveAt = z.every - move;
  const warnAt = moveAt - warn;
  const a = hzPoint(center, z, k);
  if (ph < warnAt) return { ...a, next: null, phase: 'hold', at: base + warnAt, k };
  const b = hzPoint(center, z, k + 1);
  if (ph < moveAt) return { ...a, next: b, phase: 'warn', at: base + moveAt, k };
  const f = (ph - moveAt) / move;
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, next: b, phase: 'move', at: base + z.every, k };
}
