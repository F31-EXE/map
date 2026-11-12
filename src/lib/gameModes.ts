/**
 * Big-game modes run by game techs (pure logic, tested in test/gameModes.test.ts):
 *   - the match clock: a tech starts it for N minutes, the same countdown everywhere;
 *   - territories: the field split 3×3 (numbered like the snail grid); every match
 *     minute each sector goes to the side with the most living fighters in it
 *     (a tie keeps the old owner); at the end the side holding most sectors wins;
 *   - flags: taken by outnumbering the others within 15 m for 30 s (refereed by a tech's phone);
 *     a side scores a point per minute held;
 *   - tickets: each side's lives; every «Я убит» costs one;
 *   - control zone (WARDOGS): per-fighter points summed per side;
 *   - convoy: a side escorts its convoy along a route of checkpoints to the enemy base.
 */
import { distanceMeters } from './geo';
import { insidePolygon } from './geofence';
import type { LatLng } from './types';

export type Match = { start: number; minutes: number; stoppedAt?: number | null };

export type MatchState =
  | { phase: 'none' }
  | { phase: 'running'; minute: number; left: number }
  | { phase: 'over'; endedAt: number };

export function matchState(m: Match | null | undefined, now: number): MatchState {
  if (!m) return { phase: 'none' };
  const end = Math.min(m.start + m.minutes * 60_000, m.stoppedAt ?? Infinity);
  if (now >= end) return { phase: 'over', endedAt: end };
  return { phase: 'running', minute: Math.max(0, Math.floor((now - m.start) / 60_000)), left: end - now };
}

/** Sector numbers in the 3×3 split, row by row: the snail 1 2 3 / 8 9 4 / 7 6 5. */
const SNAIL = [1, 2, 3, 8, 9, 4, 7, 6, 5];
const M_PER_DEG = 111_320;

export type Sector = { n: number; points: LatLng[]; center: LatLng };

/** Nine square sectors of `size` meters, north-aligned, centered on `center`. */
export function territorySectors(center: LatLng, size: number): Sector[] {
  const dLat = size / M_PER_DEG;
  const dLng = size / (M_PER_DEG * Math.cos((center.lat * Math.PI) / 180));
  const north = center.lat + dLat * 1.5;
  const west = center.lng - dLng * 1.5;
  const out: Sector[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const n0 = north - row * dLat;
      const w0 = west + col * dLng;
      out.push({
        n: SNAIL[row * 3 + col],
        points: [
          { lat: n0, lng: w0 },
          { lat: n0, lng: w0 + dLng },
          { lat: n0 - dLat, lng: w0 + dLng },
          { lat: n0 - dLat, lng: w0 },
        ],
        center: { lat: n0 - dLat / 2, lng: w0 + dLng / 2 },
      });
    }
  }
  return out.sort((a, b) => a.n - b.n);
}

/** The sector a point is in, if any. */
export function sectorAt<T extends { id: string; points?: LatLng[] }>(p: LatLng, sectors: T[]): T | null {
  return sectors.find((s) => s.points && insidePolygon(p, s.points)) ?? null;
}

export type Presence = { sideId: string; cell?: string | null; cellAt?: number | null };

/** Minutes of unbroken advantage a side needs to take a sector. */
export const CAPTURE_MINUTES = 3;

/** A capture under way: which side and how many minutes of advantage it has so far. */
export type CaptureProgress = { s: string; n: number } | null;

export type SectorUpdate = { id: string; cap: CaptureProgress; owner?: string };

/**
 * One match minute of territories. In each sector the side with strictly more fighters
 * reported for that minute advances its capture by a minute; after CAPTURE_MINUTES in a
 * row it takes the sector. A tie pauses the capture (contested); the other side getting
 * the upper hand restarts the count for them; an empty sector, or the owner having the
 * upper hand, cancels it. Returns only sectors whose state changes.
 */
export function territoryMinute(
  players: Presence[],
  sectors: { id: string; owner?: string | null; cap?: CaptureProgress }[],
  minute: number
): SectorUpdate[] {
  const out: SectorUpdate[] = [];
  for (const s of sectors) {
    const counts = new Map<string, number>();
    for (const p of players) {
      if (p.cell === s.id && p.cellAt === minute) counts.set(p.sideId, (counts.get(p.sideId) ?? 0) + 1);
    }
    let best: string | null = null;
    let top = 0;
    let tie = false;
    for (const [side, n] of counts) {
      if (n > top) {
        best = side;
        top = n;
        tie = false;
      } else if (n === top) tie = true;
    }
    const cur = s.cap ?? null;
    let cap: CaptureProgress;
    let owner: string | undefined;
    if (!counts.size) cap = null;
    else if (tie) cap = cur;
    else if (best === (s.owner ?? null)) cap = null;
    else {
      const n = cur && cur.s === best ? cur.n + 1 : 1;
      if (n >= CAPTURE_MINUTES) {
        owner = best!;
        cap = null;
      } else cap = { s: best!, n };
    }
    if (owner || JSON.stringify(cap) !== JSON.stringify(cur)) out.push({ id: s.id, cap, ...(owner ? { owner } : {}) });
  }
  return out;
}

/** End of a territory match: sectors per side, total holding time, the winner(s). */
export function territoryResult(
  sectors: { owner?: string | null; log?: Capture[] }[],
  until: number,
  tiebreak: 'draw' | 'time'
): { count: Record<string, number>; minutes: Record<string, number>; winners: string[] } {
  const count = holdings(sectors);
  const minutes: Record<string, number> = {};
  for (const s of sectors) {
    for (const [side, m] of Object.entries(heldMinutes(s.log, until))) minutes[side] = (minutes[side] ?? 0) + m;
  }
  let winners = leaders(count);
  if (winners.length > 1 && tiebreak === 'time') {
    const sub = Object.fromEntries(winners.map((w) => [w, minutes[w] ?? 0]));
    const byTime = leaders(sub);
    if (byTime.length) winners = byTime;
  }
  return { count, minutes, winners };
}

/** Sectors (or flags) each side holds now. */
export function holdings(items: { owner?: string | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) if (it.owner) out[it.owner] = (out[it.owner] ?? 0) + 1;
  return out;
}

export type Capture = { s: string; t: number };

/** Whole minutes each side has held a flag, from its capture log, up to `until`. */
export function heldMinutes(log: Capture[] | undefined, until: number): Record<string, number> {
  const out: Record<string, number> = {};
  const l = [...(log ?? [])].sort((a, b) => a.t - b.t);
  for (let i = 0; i < l.length; i++) {
    const end = Math.min(until, i + 1 < l.length ? l[i + 1].t : until);
    const ms = Math.max(0, end - l[i].t);
    out[l[i].s] = (out[l[i].s] ?? 0) + ms;
  }
  for (const k of Object.keys(out)) out[k] = Math.floor(out[k] / 60_000);
  return out;
}

/** Flags are taken by standing at them: no buttons, the phones stay in pockets. */
export const FLAG_RADIUS = 15;
export const FLAG_HOLD_MS = 30_000;
export type FlagCap = { s: string; t: number } | null;

/** The side with strictly more live fighters within `radius` of `pos`, or null (nobody / tie). */
export function flagLeader(
  pos: LatLng,
  fighters: { sideId: string; lat: number; lng: number }[],
  radius = FLAG_RADIUS
): string | null {
  const n: Record<string, number> = {};
  for (const f of fighters) if (distanceMeters(pos, f) <= radius) n[f.sideId] = (n[f.sideId] ?? 0) + 1;
  const ranked = Object.entries(n).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0][1])) return null;
  return ranked[0][0];
}

/**
 * One referee look at a flag: a side that outnumbers the others at it for
 * FLAG_HOLD_MS in a row takes it. Leaving, a tie or the holder outnumbering resets
 * the count; an empty flag stays with its holder.
 */
export function flagStep(
  owner: string | null,
  cap: FlagCap,
  leader: string | null,
  now: number
): { owner: string | null; cap: FlagCap; captured: boolean } {
  if (!leader || leader === owner) return { owner, cap: null, captured: false };
  if (cap?.s !== leader) return { owner, cap: { s: leader, t: now }, captured: false };
  if (now - cap.t >= FLAG_HOLD_MS) return { owner: leader, cap: null, captured: true };
  return { owner, cap, captured: false };
}

export type ScorePlayer = { sideId: string; deaths?: number; pts?: Record<string, number> };

/** Lives left per side: the start count (plus a tech's bonus) minus its fighters' deaths. */
export function ticketsLeft(start: number, sides: { id: string; tickets?: number }[], players: ScorePlayer[]) {
  const out: Record<string, number> = {};
  for (const s of sides) out[s.id] = start + (s.tickets ?? 0);
  for (const p of players) if (p.sideId in out) out[p.sideId] -= p.deaths ?? 0;
  return out;
}

/** Control-zone (WARDOGS) points per side for one zone. */
export function zonePoints(players: ScorePlayer[], zoneId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of players) {
    const v = p.pts?.[zoneId];
    if (typeof v === 'number' && Number.isFinite(v)) out[p.sideId] = (out[p.sideId] ?? 0) + v;
  }
  return out;
}

/** Side ids ranked by a score, best first; equal scores share the top. */
export function leaders(score: Record<string, number>): string[] {
  const best = Math.max(0, ...Object.values(score));
  return best > 0 ? Object.keys(score).filter((k) => score[k] === best) : [];
}

// ---------------------------------------------------------------------------
// Convoy (the `ball` marker kind, kept for compatibility): a convoy per side on a
// route drawn by a tech — start, checkpoints at every turn, the enemy base at the end.
// ---------------------------------------------------------------------------

/** Fighters within this many meters of a convoy push or block it. */
export const BALL_RADIUS = 10;
/**
 * Meters per minute for each fighter of advantage. With the usual 200–300 m route and
 * a 20–30 minute round: one free pusher needs the whole round, five need ~5 minutes,
 * so a convoy only gets through when the escort keeps winning the fight around it.
 */
export const BALL_SPEED = 10;
/** Advantage beyond this many fighters doesn't make a convoy any faster. */
export const BALL_MAX_PUSH = 5;

export type Ball = {
  /** Meters rolled along the arrow. */
  progress: number;
  /** When `progress` was last computed (ms). */
  at: number;
  /** Fighters of advantage at that moment: > 0 forward, < 0 backward, 0 standing. */
  push: number;
  /** When the ball reached the end of its arrow. */
  goal?: number | null;
};

/** Length of a path in meters. */
export function pathLength(points: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += distanceMeters(points[i - 1], points[i]);
  return d;
}

/** The point `d` meters along a path (clamped to its ends). */
export function pointAlong(points: LatLng[], d: number): LatLng {
  if (points.length === 0) return { lat: 0, lng: 0 };
  let left = Math.max(0, d);
  for (let i = 1; i < points.length; i++) {
    const seg = distanceMeters(points[i - 1], points[i]);
    if (left <= seg && seg > 0) {
      const k = left / seg;
      return {
        lat: points[i - 1].lat + (points[i].lat - points[i - 1].lat) * k,
        lng: points[i - 1].lng + (points[i].lng - points[i - 1].lng) * k,
      };
    }
    left -= seg;
  }
  return points[points.length - 1];
}

/**
 * Fighters of advantage around a convoy: each escort pushes, each enemy cancels one
 * escort (3 escorts and 1 enemy → 2). Equal or more enemies stop it; it never goes
 * back. At most BALL_MAX_PUSH.
 */
export function ballPush(owners: number, opponents: number): number {
  return Math.max(0, Math.min(owners - opponents, BALL_MAX_PUSH));
}

/** Distance along the route of each checkpoint (every point after the start; the last is the base). */
export function routeCheckpoints(points: LatLng[]): number[] {
  const out: number[] = [];
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    d += distanceMeters(points[i - 1], points[i]);
    out.push(d);
  }
  return out;
}

/** Checkpoints a convoy has passed at this progress (the base counts as the last one). */
export function checkpointsPassed(points: LatLng[], progress: number): number {
  return routeCheckpoints(points).filter((d) => progress >= d - 0.01).length;
}

/** Living fighters within BALL_RADIUS of the ball: its owners and everyone else. */
export function ballCounts(
  pos: LatLng,
  owner: string,
  fighters: { sideId: string; lat: number; lng: number }[]
): { owners: number; opponents: number } {
  let owners = 0;
  let opponents = 0;
  for (const f of fighters) {
    if (distanceMeters(pos, f) > BALL_RADIUS) continue;
    if (f.sideId === owner) owners++;
    else opponents++;
  }
  return { owners, opponents };
}

/**
 * Rolls a ball from its last state to `now` with the push it had (the referee
 * recomputes the push every few seconds). Never behind the start; at the end of the
 * arrow it's a goal and stays there.
 */
export function rollBall(ball: Ball, length: number, now: number, push: number): Ball {
  if (ball.goal) return ball;
  const dt = Math.max(0, now - ball.at);
  const progress = Math.min(length, Math.max(0, ball.progress + (ball.push * BALL_SPEED * dt) / 60_000));
  return { progress, at: now, push, goal: progress >= length ? now : null };
}

/**
 * Convoy result: the first convoy delivered wins. Otherwise the most checkpoints
 * passed, then the larger share of the route; equal is a draw (every leader). With a
 * single convoy that didn't make it, the defending sides win.
 */
export function convoyResult(
  convoys: { owner: string; progress: number; length: number; checkpoints: number; goal?: number | null }[],
  sides: string[] = []
): string[] {
  const done = convoys.filter((b) => b.goal).sort((a, b) => (a.goal as number) - (b.goal as number));
  if (done.length) return [done[0].owner];
  if (convoys.length === 1) {
    const defenders = sides.filter((s) => s !== convoys[0].owner);
    if (defenders.length) return defenders;
  }
  const score: Record<string, number> = {};
  for (const b of convoys) {
    score[b.owner] = b.checkpoints * 10_000 + Math.round((b.length > 0 ? b.progress / b.length : 0) * 1000);
  }
  return leaders(score);
}

export const SIDE_COLORS = ['#3D9BFF', '#FF4D4D', '#4ADE80', '#FFC83D', '#B79CFF', '#22D3EE'];

/** Orange diamond: how game techs look on the map. */
export const TECH_COLOR = '#FF8A1F';
