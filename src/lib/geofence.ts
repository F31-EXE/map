/**
 * Zones drawn on the map that warn the player: a dead zone or enemy zone when you walk
 * in, the playing-field boundary when you walk out. Pure logic; the map screen buzzes.
 */
import type { LatLng } from './types';

export type AreaKind = 'area-dead' | 'area-enemy' | 'area-bound';

export const AREA_KINDS: AreaKind[] = ['area-dead', 'area-enemy', 'area-bound'];

export function isArea(kind: string): kind is AreaKind {
  return (AREA_KINDS as string[]).includes(kind);
}

/** Ray casting in degrees; fine at the size of a playing field. */
export function insidePolygon(p: LatLng, poly: LatLng[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) {
      inside = !inside;
    }
  }
  return inside;
}

/** Average of the corners: where the zone's label and marker point go. */
export function centroid(poly: LatLng[]): LatLng {
  const n = poly.length || 1;
  return {
    lat: poly.reduce((s, p) => s + p.lat, 0) / n,
    lng: poly.reduce((s, p) => s + p.lng, 0) / n,
  };
}

export type Area = { id: string; kind: AreaKind; label: string; points: LatLng[] };

export type ZoneAlert =
  | { type: 'enter'; area: Area }
  | { type: 'leaveBound'; area: Area }
  | { type: 'backInBound'; area: Area };

/**
 * Turns a stream of GPS fixes into alerts. A change only counts once two fixes in a
 * row agree, so GPS jitter along an edge doesn't buzz every few seconds; fixes worse
 * than `maxAccuracy` meters are ignored.
 */
export class ZoneWatcher {
  /** Zone ids the player is confirmed to be inside. */
  private inside = new Set<string>();
  private pending = new Map<string, boolean>();
  private known = false;
  private maxAccuracy: number;

  constructor(maxAccuracy = 35) {
    this.maxAccuracy = maxAccuracy;
  }

  update(p: LatLng & { accuracy?: number | null }, areas: Area[]): ZoneAlert[] {
    if (p.accuracy != null && p.accuracy > this.maxAccuracy) return [];
    const alerts: ZoneAlert[] = [];
    const ids = new Set(areas.map((a) => a.id));
    for (const id of [...this.inside]) if (!ids.has(id)) this.inside.delete(id);
    for (const id of [...this.pending.keys()]) if (!ids.has(id)) this.pending.delete(id);
    for (const a of areas) {
      const now = insidePolygon(p, a.points);
      const was = this.inside.has(a.id);
      if (now === was) {
        this.pending.delete(a.id);
        continue;
      }
      // First fix after start (or a new zone): take it as it is, no alert.
      if (!this.known) {
        if (now) this.inside.add(a.id);
        continue;
      }
      if (this.pending.get(a.id) !== now) {
        this.pending.set(a.id, now);
        continue;
      }
      this.pending.delete(a.id);
      if (now) this.inside.add(a.id);
      else this.inside.delete(a.id);
      if (a.kind === 'area-bound') alerts.push({ type: now ? 'backInBound' : 'leaveBound', area: a });
      else if (now) alerts.push({ type: 'enter', area: a });
    }
    this.known = true;
    return alerts;
  }

  /** Zones the player is in right now (for a persistent warning). */
  current(areas: Area[]): Area[] {
    return areas.filter((a) => this.inside.has(a.id));
  }
}
