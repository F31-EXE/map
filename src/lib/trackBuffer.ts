/**
 * Movement recording on the phone itself: points are kept locally and uploaded in
 * batches when the server is reachable, so a game in patchy coverage still records the
 * whole route. Pure logic; storage and upload live in src/state/session.tsx.
 */
import { distanceMeters } from './geo';
import type { LatLng } from './types';
import type { TrackPoint } from './tracks';

/** Sampling: at most one point per MIN_MS, and only after moving, except a heartbeat. */
export const TRACK_MIN_MS = 4_000;
export const TRACK_MOVE_M = 3;
export const TRACK_HEARTBEAT_MS = 30_000;
/** Upload batch size (one Firestore write). */
export const TRACK_BATCH = 400;
/** A recording's points kept on the phone at most (matches the rules' list limit). */
export const TRACK_MAX_POINTS = 20_000;

/** Points waiting for upload, per `teamId/recId`. */
export type PendingTracks = Record<string, TrackPoint[]>;

export const pendingKey = (teamId: string, recId: string) => `${teamId}/${recId}`;

export function shouldSample(last: TrackPoint | null, p: LatLng, now: number): boolean {
  if (!last) return true;
  const dt = now - last.t;
  if (dt < TRACK_MIN_MS) return false;
  return dt >= TRACK_HEARTBEAT_MS || distanceMeters(last, p) >= TRACK_MOVE_M;
}

export function addPoint(buf: PendingTracks, key: string, p: TrackPoint): PendingTracks {
  const list = buf[key] ?? [];
  const next = [...list, { lat: p.lat, lng: p.lng, t: p.t }];
  return { ...buf, [key]: next.length > TRACK_MAX_POINTS ? next.slice(-TRACK_MAX_POINTS) : next };
}

/** The next batch to upload: oldest points of the first recording with any. */
export function nextBatch(buf: PendingTracks): { key: string; points: TrackPoint[] } | null {
  for (const [key, list] of Object.entries(buf)) {
    if (list.length) return { key, points: list.slice(0, TRACK_BATCH) };
  }
  return null;
}

/** Removes uploaded points (by time; a point's `t` is unique within a track). */
export function dropSent(buf: PendingTracks, key: string, sent: TrackPoint[]): PendingTracks {
  const done = new Set(sent.map((p) => p.t));
  const left = (buf[key] ?? []).filter((p) => !done.has(p.t));
  const out = { ...buf };
  if (left.length) out[key] = left;
  else delete out[key];
  return out;
}

export function pendingCount(buf: PendingTracks): number {
  return Object.values(buf).reduce((n, l) => n + l.length, 0);
}
