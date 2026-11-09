/**
 * Own breadcrumb trail: where I walked in the last minutes, to find the way back.
 * Pure logic; points are kept on the phone only.
 */
import { distanceMeters } from './geo';
import type { LatLng } from './types';

export type TrailPoint = { lat: number; lng: number; t: number };

export const TRAIL_CHOICES = [0, 15, 30, 60];
/** Kept no longer than the longest choice. */
export const TRAIL_KEEP_MS = 60 * 60_000;
/** A new crumb when moved this far; standing still doesn't grow the list. */
const MIN_STEP_M = 5;
/** While standing still, the last crumb's time is refreshed this often. */
const MIN_GAP_MS = 60_000;

/** Adds a fix if it's a new crumb; returns the (possibly same) list, trimmed. */
export function addCrumb(
  trail: TrailPoint[],
  p: LatLng & { accuracy?: number | null },
  now: number
): TrailPoint[] {
  // Very rough fixes only scribble.
  if (p.accuracy != null && p.accuracy > 40) return trail;
  const last = trail[trail.length - 1];
  if (last && distanceMeters(last, p) < MIN_STEP_M) {
    // Standing still: just keep the last crumb fresh so it doesn't age out.
    if (now - last.t < MIN_GAP_MS) return trail;
    return [...trail.slice(0, -1), { ...last, t: now }];
  }
  return [...trail.filter((c) => now - c.t <= TRAIL_KEEP_MS), { lat: p.lat, lng: p.lng, t: now }];
}

/** The crumbs of the last `minutes`. */
export function recentTrail(trail: TrailPoint[], minutes: number, now: number): TrailPoint[] {
  if (minutes <= 0) return [];
  return trail.filter((c) => now - c.t <= minutes * 60_000);
}
