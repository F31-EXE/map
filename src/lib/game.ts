/**
 * Game by teams (WARDOGS-style scoring), run by the squad creator as game master:
 * players of the squad are split into up to six teams; each sees only their own team on
 * the map. Every minute of a control zone, each living player inside it earns their team
 * 1 point, or 2 inside the hot zone. Each phone counts its own player and adds the points
 * to its member doc (`pts.<zoneId>`); team scores are sums over members.
 *
 * Hiding the other teams is a display filter, not a security boundary: squad members can
 * read every member doc.
 */
import { distanceMeters } from './geo';
import type { HotState, HotZone } from './hotzone';
import type { LatLng } from './types';

export type Faction = { name: string; color: string };

export const MAX_FACTIONS = 6;

export const FACTION_PRESETS: Faction[] = [
  { name: 'Красные', color: '#FF4D4D' },
  { name: 'Синие', color: '#3D9BFF' },
  { name: 'Зелёные', color: '#4ADE80' },
  { name: 'Жёлтые', color: '#FFC83D' },
  { name: 'Фиолетовые', color: '#B79CFF' },
  { name: 'Белые', color: '#F2F2F2' },
];

export function defaultFactions(n: number): Faction[] {
  return FACTION_PRESETS.slice(0, Math.max(0, Math.min(MAX_FACTIONS, n)));
}

export function validFaction(f: unknown, count: number): f is number {
  return typeof f === 'number' && Number.isInteger(f) && f >= 0 && f < count;
}

/**
 * Whether a viewer sees an item (player, marker, message) of `item`'s team. The game
 * master sees everything; items without a team (the master's own) are public; with no
 * game running everyone sees everything.
 */
export function visibleTo(
  viewer: { gameOn: boolean; isMaster: boolean; faction: number | null },
  item: number | null | undefined
): boolean {
  if (!viewer.gameOn || viewer.isMaster || item == null) return true;
  return item === viewer.faction;
}

export const SCORE_TICK_MS = 60_000;

/** Index of the scoring minute (0 before the zone starts counting). */
export function scoreMinute(zone: HotZone, now: number): number {
  return Math.max(0, Math.floor((now - zone.start) / SCORE_TICK_MS));
}

/** Points for one minute at `p`: 2 in the hot zone, 1 elsewhere in the control zone. */
export function pointsAt(p: LatLng, center: LatLng, zone: HotZone, st: HotState): number {
  if (distanceMeters(p, st) <= zone.hot) return 2;
  if (distanceMeters(p, center) <= zone.r) return 1;
  return 0;
}

/** Team totals for one zone, from members' `pts` maps. */
export function teamScores(
  members: { faction?: number | null; pts?: Record<string, number> }[],
  zoneId: string,
  count: number
): number[] {
  const out = new Array<number>(count).fill(0);
  for (const m of members) {
    if (!validFaction(m.faction, count)) continue;
    const v = m.pts?.[zoneId];
    if (typeof v === 'number' && Number.isFinite(v)) out[m.faction] += v;
  }
  return out;
}
