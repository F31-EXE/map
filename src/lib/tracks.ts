import { distanceMeters } from './geo';
import type { LatLng } from './types';

export type TrackPoint = LatLng & { t: number };

/**
 * Gaps longer than this mean the phone was off or out of coverage: don't bridge them.
 * Generous on purpose: with the screen off (no background mode) a phone may report only
 * every few minutes, and a stricter limit used to leave the whole game blank.
 */
export const MAX_GAP_MS = 10 * 60_000;

/**
 * Positions arrive irregularly: every few seconds while moving, every 30 s while
 * standing still. For a "where did people spend time" heatmap, resample each track to
 * one point per `stepMs` of elapsed time, interpolating along each segment, so a
 * player holding a spot for ten minutes weighs as much as ten minutes of walking.
 */
export function resampleByTime(points: TrackPoint[], stepMs = 10_000): LatLng[] {
  const out: LatLng[] = [];
  for (const seg of splitSegments(points)) {
    // Every stretch counts, even a lone point between long gaps.
    let next = seg[0].t;
    for (let i = 0; i < seg.length - 1; i++) {
      const a = seg[i];
      const b = seg[i + 1];
      const dt = b.t - a.t;
      for (; next < b.t; next += stepMs) {
        const k = dt > 0 ? (next - a.t) / dt : 0;
        out.push({ lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k });
      }
    }
    const last = seg[seg.length - 1];
    out.push({ lat: last.lat, lng: last.lng });
  }
  return out;
}

/** Splits a track wherever there is a long gap, so lines aren't drawn across it. */
export function splitSegments(points: TrackPoint[]): TrackPoint[][] {
  const pts = [...points].sort((a, b) => a.t - b.t);
  const out: TrackPoint[][] = [];
  let cur: TrackPoint[] = [];
  for (const p of pts) {
    if (cur.length && p.t - cur[cur.length - 1].t > MAX_GAP_MS) {
      out.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}

export function trackStats(points: TrackPoint[]): { distance: number; duration: number } {
  let distance = 0;
  let duration = 0;
  for (const seg of splitSegments(points)) {
    for (let i = 1; i < seg.length; i++) distance += distanceMeters(seg[i - 1], seg[i]);
    if (seg.length > 1) duration += seg[seg.length - 1].t - seg[0].t;
  }
  return { distance, duration };
}

export function formatDuration(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`;
}
