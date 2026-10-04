/**
 * Store-and-forward mesh over phone-to-phone links (Bluetooth / Wi-Fi Direct via
 * Nearby, see modules/grim-mesh). Pure logic, no React Native: every phone keeps the
 * freshest position of each fighter and recent chat, passes anything new on to its
 * other neighbours, and hands everything it holds to a phone that just connected.
 * So news travels hop by hop between fighters who can't see each other directly.
 */
import { roleOf, type RoleId } from './roles';
import type { Member, MemberStatus } from './types';

export const MESH_SERVICE_ID = 'com.f31.grimmap.mesh';
/** Hops a message may travel; each phone adds one when passing it on. */
export const MAX_HOPS = 8;
/** Positions older than this are no longer passed around. */
export const POS_TTL_MS = 15 * 60_000;
export const CHAT_TTL_MS = 3 * 60 * 60_000;
const MAX_CHATS = 150;
/** Nearby's byte payloads top out at 32 KB; stay well under it. */
export const MAX_PACKET_BYTES = 24_000;

export type MeshPos = {
  uid: string;
  callsign: string;
  role: RoleId;
  status: MemberStatus;
  /** May issue orders (for the roster when the server is out of reach). */
  cmd: boolean;
  lat: number;
  lng: number;
  heading: number | null;
  accuracy: number | null;
};

export type MeshChat = { id: string; uid: string; callsign: string; text: string };

export type Envelope =
  | { v: 1; id: string; team: string; t: number; hops: number; kind: 'pos'; body: MeshPos }
  | { v: 1; id: string; team: string; t: number; hops: number; kind: 'chat'; body: MeshChat };

const isStr = (x: unknown, max = 200): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Rejects anything malformed: payloads come from other phones. */
export function validEnvelope(e: unknown): e is Envelope {
  if (!e || typeof e !== 'object') return false;
  const o = e as Record<string, unknown>;
  if (o.v !== 1 || !isStr(o.id, 120) || !isStr(o.team, 64) || !isNum(o.t) || !isNum(o.hops)) return false;
  const b = o.body as Record<string, unknown> | undefined;
  if (!b || typeof b !== 'object' || !isStr(b.uid, 128) || !isStr(b.callsign, 24)) return false;
  if (o.kind === 'pos') {
    return (
      isNum(b.lat) &&
      isNum(b.lng) &&
      Math.abs(b.lat) <= 90 &&
      Math.abs(b.lng) <= 180 &&
      (b.status === 'alive' || b.status === 'dead' || b.status === 'afk')
    );
  }
  if (o.kind === 'chat') return isStr(b.id, 120) && isStr(b.text, 500);
  return false;
}

export function posEnvelope(team: string, p: MeshPos, t: number): Envelope {
  return { v: 1, id: `p:${p.uid}:${t}`, team, t, hops: 0, kind: 'pos', body: p };
}

export function chatEnvelope(team: string, c: MeshChat, t: number): Envelope {
  return { v: 1, id: `c:${c.id}`, team, t, hops: 0, kind: 'chat', body: c };
}

/** What one phone knows. */
export class MeshStore {
  private seen = new Map<string, number>();
  /** Freshest position per fighter. */
  readonly positions = new Map<string, Envelope & { kind: 'pos' }>();
  readonly chats = new Map<string, Envelope & { kind: 'chat' }>();

  readonly team: string;

  constructor(team: string) {
    this.team = team;
  }

  /**
   * Takes an envelope from a neighbour (or our own). True when it's news: deliver it
   * and pass it on. Old, duplicate, foreign-squad and over-travelled ones are dropped.
   */
  accept(e: Envelope, now: number): boolean {
    if (e.team !== this.team || e.hops > MAX_HOPS || this.seen.has(e.id)) return false;
    // Clocks differ between phones; only drop what is clearly stale.
    if (e.kind === 'pos' && now - e.t > POS_TTL_MS) return false;
    if (e.kind === 'chat' && now - e.t > CHAT_TTL_MS) return false;
    this.seen.set(e.id, now);
    if (e.kind === 'pos') {
      const cur = this.positions.get(e.body.uid);
      if (cur && cur.t >= e.t) return false;
      this.positions.set(e.body.uid, e);
    } else {
      this.chats.set(e.body.id, e);
      if (this.chats.size > MAX_CHATS) {
        const oldest = [...this.chats.values()].sort((a, b) => a.t - b.t)[0];
        this.chats.delete(oldest.body.id);
      }
    }
    return true;
  }

  /** Everything worth giving a newly connected neighbour. */
  snapshot(now: number): Envelope[] {
    this.prune(now);
    return [...this.positions.values(), ...[...this.chats.values()].sort((a, b) => a.t - b.t)];
  }

  prune(now: number) {
    for (const [uid, e] of this.positions) if (now - e.t > POS_TTL_MS) this.positions.delete(uid);
    for (const [id, e] of this.chats) if (now - e.t > CHAT_TTL_MS) this.chats.delete(id);
    for (const [id, at] of this.seen) if (now - at > CHAT_TTL_MS) this.seen.delete(id);
  }
}

/** The same envelope one hop further. */
export function forwarded(e: Envelope): Envelope {
  return { ...e, hops: e.hops + 1 };
}

/** Packs envelopes into JSON packets, each under the payload limit. */
export function pack(list: Envelope[], maxBytes = MAX_PACKET_BYTES): string[] {
  const packets: string[] = [];
  let cur: string[] = [];
  let size = 2;
  for (const e of list) {
    const s = JSON.stringify(e);
    // Cyrillic is 2 bytes per char in UTF-8; count conservatively.
    const bytes = s.length * 2 + 1;
    if (cur.length && size + bytes > maxBytes) {
      packets.push(`[${cur.join(',')}]`);
      cur = [];
      size = 2;
    }
    cur.push(s);
    size += bytes;
  }
  if (cur.length) packets.push(`[${cur.join(',')}]`);
  return packets;
}

/** Valid envelopes from a received packet; garbage yields nothing. */
export function unpack(data: string): Envelope[] {
  try {
    const v: unknown = JSON.parse(data);
    return (Array.isArray(v) ? v : [v]).filter(validEnvelope);
  } catch {
    return [];
  }
}

/**
 * Roster as the map should show it: server data, with any fresher position or status
 * heard over the mesh, plus fighters only the mesh knows about (server unreachable).
 */
export function mergeMeshMembers(members: Member[], positions: Iterable<Envelope & { kind: 'pos' }>): Member[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  for (const e of positions) {
    const p = e.body;
    const m = byId.get(p.uid);
    if (m && (m.updatedAt ?? 0) >= e.t) continue;
    byId.set(p.uid, {
      ...(m ?? { id: p.uid, canCommand: p.cmd }),
      callsign: m?.callsign ?? p.callsign,
      role: m?.role ?? roleOf(p.role),
      status: p.status,
      lat: p.lat,
      lng: p.lng,
      heading: p.heading,
      updatedAt: e.t,
      viaMesh: true,
    });
  }
  return [...byId.values()];
}

/** Endpoint name: squad tag first, so phones of other squads are ignored. */
export function endpointName(teamId: string, uid: string, callsign: string): string {
  return `${squadTag(teamId)}|${uid.slice(0, 10)}|${callsign.slice(0, 12)}`;
}

export function squadTag(teamId: string): string {
  return teamId.slice(0, 10);
}

/** Of two phones that see each other, the one with the smaller id dials. */
export function shouldDial(myName: string, theirName: string): boolean {
  return myName < theirName;
}
