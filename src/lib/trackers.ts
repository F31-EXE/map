/**
 * Trackers: Meshtastic radios with GPS and no phone (a fighter without one, a radio
 * handed to an allied unit), tied to a squad. Squad radios hear their positions on
 * the squad channel; a phone with internet relays them to the server so everyone in
 * the squad sees them. Pure, tested in test/trackers.test.ts.
 */
import { utf8Encode } from './protobuf';
import type { RoleId } from './roles';

export type TrackerVis = 'all' | 'commanders' | 'chosen';

export const TRACKER_VIS: { id: TrackerVis; title: string }[] = [
  { id: 'all', title: 'Все' },
  { id: 'commanders', title: 'Только командиры' },
  { id: 'chosen', title: 'Выбранные бойцы' },
];

export type Tracker = {
  /** Meshtastic node number. */
  num: number;
  name: string;
  short: string;
  role: RoleId;
  color: string;
  vis: TrackerVis;
  /** Who sees it with vis 'chosen' (commanders always do). */
  viewers: string[];
  addedBy: string;
  /** Last position the server knows; `at` = when a squad phone heard it (ms). */
  lat: number | null;
  lng: number | null;
  at: number | null;
  heardBy: string | null;
};

/** A tracker's position as this phone's radio heard it. */
export type HeardFix = { lat: number; lng: number; at: number };

/** Firestore document id of a tracker: its node number in hex, like Meshtastic's «!a1b2c3d4». */
export const trackerId = (num: number) => (num >>> 0).toString(16).padStart(8, '0');

/** Parses «!a1b2c3d4», «a1b2c3d4» or a decimal node number. */
export function parseNodeId(s: string): number | null {
  const t = s.trim().toLowerCase();
  const hex = /^!?([0-9a-f]{8})$/.exec(t);
  if (hex) return parseInt(hex[1], 16) >>> 0;
  if (/^\d{1,10}$/.test(t)) {
    const n = Number(t);
    return n > 0 && n <= 0xffffffff ? n : null;
  }
  return null;
}

export function canSeeTracker(t: Pick<Tracker, 'vis' | 'viewers'>, uid: string | null, isCommander: boolean): boolean {
  if (isCommander || t.vis === 'all') return true;
  return t.vis === 'chosen' && uid != null && t.viewers.includes(uid);
}

/** The newer of the server's position and what my radio heard. */
export function trackerFix(t: Pick<Tracker, 'lat' | 'lng' | 'at'>, heard: HeardFix | null): HeardFix | null {
  const server = t.lat != null && t.lng != null && t.at != null ? { lat: t.lat, lng: t.lng, at: t.at } : null;
  if (!server) return heard;
  if (!heard) return server;
  return heard.at > server.at ? heard : server;
}

/** A heard position goes to the server at most this often per tracker (daily write limit). */
export const RELAY_EVERY_MS = 60_000;

/**
 * Whether this phone should write what it heard: newer than the server's by a minute,
 * and this phone hasn't written this tracker in the last minute.
 */
export function shouldRelay(t: Pick<Tracker, 'at'>, heard: HeardFix | null, lastRelay: number | null, now: number): boolean {
  if (!heard) return false;
  if (now - heard.at > 10 * 60_000) return false;
  if (t.at != null && heard.at - t.at < RELAY_EVERY_MS) return false;
  return lastRelay == null || now - lastRelay >= RELAY_EVERY_MS;
}

/** Long name trimmed to what the radio stores (24 bytes of UTF-8), on a character boundary. */
export function clipName(s: string, bytes = 24): string {
  let out = '';
  for (const ch of s.trim()) {
    if (utf8Encode(out + ch).length > bytes) break;
    out += ch;
  }
  return out;
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/**
 * A short name from a long one, in Latin letters: the radio keeps 4 bytes, which is
 * only two Cyrillic letters. «Союзники-1» → «SOY1», «Гром» → «GROM».
 */
export function shortFrom(name: string): string {
  const clean = name.trim();
  const digits = (/(\d+)\s*$/.exec(clean)?.[1] ?? '').slice(-2);
  const latin = [...clean.toLowerCase()]
    .map((c) => TRANSLIT[c] ?? (/[a-z]/.test(c) ? c : ''))
    .join('');
  const letters = latin.slice(0, 4 - digits.length).toUpperCase();
  return (letters + digits).slice(0, 4) || 'TRK';
}
