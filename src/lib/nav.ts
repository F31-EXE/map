/**
 * "Lead me there": walking speed from recent GPS fixes and the time to a target.
 * Pure logic; the map screen shows the arrow and buzzes on arrival.
 */
import { distanceMeters } from './geo';
import type { LatLng } from './types';

/** Assumed pace when standing still or before there's enough track: ~4.5 km/h. */
export const WALK_MPS = 1.25;
/** Closer than this counts as "there". */
export const ARRIVE_M = 15;
const WINDOW_MS = 30_000;

/** Average speed over the last half minute of fixes. */
export class SpeedTracker {
  private fixes: { t: number; p: LatLng }[] = [];

  push(p: LatLng, t: number) {
    this.fixes.push({ t, p: { lat: p.lat, lng: p.lng } });
    while (this.fixes.length > 2 && t - this.fixes[0].t > WINDOW_MS) this.fixes.shift();
  }

  /** m/s, or null with too little track to tell. */
  speed(): number | null {
    if (this.fixes.length < 2) return null;
    const first = this.fixes[0];
    const last = this.fixes[this.fixes.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt < 5) return null;
    let d = 0;
    for (let i = 1; i < this.fixes.length; i++) d += distanceMeters(this.fixes[i - 1].p, this.fixes[i].p);
    return d / dt;
  }
}

/** Seconds to cover `meters`, at the measured pace if moving, else at walking pace. */
export function etaSeconds(meters: number, speed: number | null): number {
  const v = speed != null && speed >= 0.5 ? speed : WALK_MPS;
  return meters / v;
}

export function formatEta(sec: number): string {
  if (sec < 60) return '< 1 мин';
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`;
}
