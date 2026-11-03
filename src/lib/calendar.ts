/**
 * Link with the THE GRIM TEAM calendar (Firebase project `strikeball-calendar`, games are
 * publicly readable through the Firestore REST API). A game may carry a polygon map file
 * (`mapUrl`, KMZ/KML/GPX/GeoJSON in Storage) and points as text, one per line:
 * «тип | широта, долгота | подпись» — the same format the calendar site and app parse.
 *
 * Deep links: the calendar opens `grimmap://polygon?game=<id>` (route src/app/polygon.tsx);
 * GrimMap opens a game back with `grimteam://game?id=<id>` or the site's `#game=<id>`.
 */
import type { AdminKind, LatLng, OverlayFormat } from './types';

export const CALENDAR_PROJECT = 'strikeball-calendar';
export const CALENDAR_BASE = `https://firestore.googleapis.com/v1/projects/${CALENDAR_PROJECT}/databases/(default)/documents`;

export type CalendarPoint = { kind: AdminKind; lat: number; lng: number; label: string };
export type CalendarGame = {
  id: string;
  title: string;
  start: string;
  location: string;
  center: LatLng | null;
  mapUrl: string;
  mapName: string;
  points: CalendarPoint[];
  cancelled: boolean;
};

export const POINT_LABEL: Record<AdminKind, string> = {
  respawn: 'Респ',
  deadzone: 'Мертвяк',
  parking: 'Парковка',
  admin: 'Админ',
};

export function parseMapPoints(text: unknown): CalendarPoint[] {
  const out: CalendarPoint[] = [];
  for (const line of String(text ?? '').split('\n')) {
    const parts = line.split('|').map((x) => x.trim());
    if (parts.length < 2) continue;
    const k = parts[0].toLowerCase();
    const kind: AdminKind = /респ|respawn/.test(k)
      ? 'respawn'
      : /мертв|dead/.test(k)
        ? 'deadzone'
        : /парк|park/.test(k)
          ? 'parking'
          : 'admin';
    const m = /(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)/.exec(parts[1]);
    if (!m) continue;
    const lat = parseFloat(m[1].replace(',', '.'));
    const lng = parseFloat(m[2].replace(',', '.'));
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) continue;
    out.push({ kind, lat, lng, label: (parts[2] ?? '').slice(0, 40) });
  }
  return out;
}

type FsValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  timestampValue?: string;
  arrayValue?: { values?: FsValue[] };
  mapValue?: { fields?: Record<string, FsValue> };
};
export type FsDoc = { name: string; fields?: Record<string, FsValue> };

function fsValue(v: FsValue): unknown {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.arrayValue !== undefined) return (v.arrayValue.values ?? []).map(fsValue);
  if (v.mapValue !== undefined) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v.mapValue.fields ?? {})) o[k] = fsValue(x);
    return o;
  }
  return null;
}

export function toCalendarGame(doc: FsDoc): CalendarGame {
  const f: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.fields ?? {})) f[k] = fsValue(v);
  const points = parseMapPoints(f.mapPoints);
  const lat = typeof f.lat === 'number' ? f.lat : NaN;
  const lng = typeof f.lng === 'number' ? f.lng : NaN;
  let center: LatLng | null = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  if (!center && points.length) {
    center = {
      lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
      lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
    };
  }
  return {
    id: doc.name.split('/').pop() ?? '',
    title: String(f.title ?? 'Игра'),
    start: String(f.startDate ?? f.date ?? ''),
    location: String(f.location ?? ''),
    center,
    mapUrl: /^https:\/\//.test(String(f.mapUrl ?? '')) ? String(f.mapUrl) : '',
    mapName: String(f.mapName ?? ''),
    points,
    cancelled: f.cancelled === true,
  };
}

/** Upcoming, not cancelled games that have something to show on the map, soonest first. */
export function upcomingWithMap(games: CalendarGame[], now = Date.now()): CalendarGame[] {
  return games
    .filter((g) => !g.cancelled && Date.parse(g.start) > now - 12 * 3600_000 && (g.center || g.mapUrl))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export function formatFromName(name: string): OverlayFormat | null {
  const ext = /\.([a-z0-9]+)(?:$|\?)/i.exec(decodeURIComponent(name.split('/').pop() ?? ''))?.[1]?.toLowerCase();
  if (ext === 'kmz' || ext === 'kml' || ext === 'gpx') return ext;
  if (ext === 'geojson' || ext === 'json') return 'geojson';
  return null;
}

export function formatGameDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg' });
}

export const calendarAppLink = (id: string) => `grimteam://game?id=${encodeURIComponent(id)}`;
export const calendarWebLink = (id: string) => `https://airsoft-calendar-tgt.ru/#game=${encodeURIComponent(id)}`;
