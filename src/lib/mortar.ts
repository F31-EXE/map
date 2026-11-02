/**
 * Mortar fire solution: distance, azimuth and elevation from the firing position to a
 * target. Airsoft mortars are fired high-angle (45°–85°). Without calibration the
 * elevation comes from the drag-free model, scaled so the maximum range is reached at
 * 45°: θ = 90° − ½·asin(d / R). With two or more test shots ("angle → where it landed")
 * the angle is interpolated from them instead, which also absorbs drag and gas pressure.
 */
import { bearingDegrees, distanceMeters } from './geo';
import type { LatLng } from './types';

export type ShotPoint = { angle: number; dist: number };

export type MortarConfig = {
  /** Maximum range, m: the circle drawn around the mortar. */
  range: number;
  /** Test shots for this mortar; used once there are at least two. */
  table: ShotPoint[];
};

export const DEFAULT_RANGE = 200;
export const RANGE_CHOICES = [100, 150, 200, 250, 300, 400];
export const MIN_ANGLE = 45;
export const MAX_ANGLE = 85;
export const DEFAULT_MORTAR: MortarConfig = { range: DEFAULT_RANGE, table: [] };
const G = 9.81;

export type FireSolution = {
  dist: number;
  /** Degrees from north. */
  bearing: number;
  /** Elevation in degrees, null when the target can't be reached. */
  angle: number | null;
  /** Seconds in the air (drag-free estimate). */
  flight: number | null;
  /** 'far' beyond the range, 'close' inside the minimum range (steeper than MAX_ANGLE). */
  reach: 'ok' | 'far' | 'close';
  /** Angle taken from test shots rather than the model. */
  calibrated: boolean;
};

export function validConfig(v: unknown): MortarConfig {
  const c = (v ?? {}) as Partial<MortarConfig>;
  const range = typeof c.range === 'number' && c.range > 0 && c.range <= 2000 ? c.range : DEFAULT_RANGE;
  const table = Array.isArray(c.table)
    ? c.table.filter(
        (p): p is ShotPoint =>
          !!p && Number.isFinite(p.angle) && Number.isFinite(p.dist) && p.angle > 0 && p.angle < 90 && p.dist > 0
      )
    : [];
  return { range, table };
}

/** Elevation for `dist` from test shots (linear between neighbours, extended past the ends). */
function angleFromTable(dist: number, table: ShotPoint[]): number {
  const t = [...table].sort((a, b) => a.dist - b.dist);
  let i = t.findIndex((p) => p.dist >= dist);
  if (i <= 0) i = i === 0 ? 1 : t.length - 1;
  const a = t[i - 1];
  const b = t[i];
  if (b.dist === a.dist) return (a.angle + b.angle) / 2;
  return a.angle + ((dist - a.dist) * (b.angle - a.angle)) / (b.dist - a.dist);
}

export function solve(from: LatLng, to: LatLng, cfg: MortarConfig): FireSolution {
  const dist = distanceMeters(from, to);
  const bearing = bearingDegrees(from, to);
  const calibrated = cfg.table.length >= 2;
  if (dist > cfg.range) return { dist, bearing, angle: null, flight: null, reach: 'far', calibrated };
  const raw = calibrated
    ? angleFromTable(dist, cfg.table)
    : 90 - (Math.asin(Math.min(1, dist / cfg.range)) * 90) / Math.PI;
  const angle = Math.round(Math.min(89.9, Math.max(MIN_ANGLE, raw)) * 10) / 10;
  const v = Math.sqrt(G * cfg.range);
  const flight = Math.round(((2 * v * Math.sin((angle * Math.PI) / 180)) / G) * 10) / 10;
  return { dist, bearing, angle, flight, reach: angle > MAX_ANGLE ? 'close' : 'ok', calibrated };
}

/** Azimuth in Russian goniometer divisions (6000 per turn), written "12-50". */
export function formatMils(bearing: number): string {
  const d = Math.round((((bearing % 360) + 360) % 360) * (6000 / 360)) % 6000;
  return `${Math.floor(d / 100)}-${String(d % 100).padStart(2, '0')}`;
}

/** Point `meters` away from `p` along `bearing` (flat earth; fine over a few hundred meters). */
export function offsetPoint(p: LatLng, bearing: number, meters: number): LatLng {
  const a = (bearing * Math.PI) / 180;
  const north = Math.cos(a) * meters;
  const east = Math.sin(a) * meters;
  return {
    lat: p.lat + north / 111_320,
    lng: p.lng + east / (111_320 * Math.cos((p.lat * Math.PI) / 180)),
  };
}

/**
 * Spotter's correction moves the aim point: `longer` meters further along the line of
 * fire (negative: shorter), `right` meters to the right of it (negative: left).
 */
export function correct(from: LatLng, target: LatLng, longer: number, right: number): LatLng {
  const b = bearingDegrees(from, target);
  return offsetPoint(offsetPoint(target, b, longer), b + 90, right);
}
