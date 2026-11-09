/**
 * GrimMap envelopes (src/lib/mesh.ts) as Meshtastic payloads (PRIVATE_APP port). LoRa
 * is slow (~1 kbit/s shared by everyone) and a packet carries at most 233 bytes, so
 * positions get a compact binary form that fits one packet; markers, chat and votes
 * go as JSON and are cut into numbered fragments when they don't fit.
 *
 * Packet: 'G' | (version << 4 | kind) | team hash (4) | t (float64 ms) | hops | body
 * Fragment: 'G' | 0xF0 | message id (2) | index | count | chunk
 */
import {
  chatEnvelope,
  markEnvelope,
  posEnvelope,
  validEnvelope,
  voteEnvelope,
  type Envelope,
  type MeshPos,
} from './mesh';
import { MAX_PAYLOAD } from './meshtastic';
import { utf8Clip, utf8Decode, utf8Encode } from './protobuf';
import { ROLE_ORDER, roleOf } from './roles';

const MAGIC = 0x47;
const VERSION = 1;
const FRAG = 0xf0;
const KINDS = ['pos', 'chat', 'mark', 'vote'] as const;
const STATUSES = ['alive', 'dead', 'afk'] as const;
const HEADER = 15;
const FRAG_HEADER = 6;
/** Longest message we cut up (≈ 8 packets); anything bigger isn't worth the airtime. */
export const MAX_FRAGMENTS = 8;
const NONE16 = 0xffff;

/** FNV-1a: four bytes that tell squads apart without sending the team id. */
export function teamHash(teamId: string): number {
  let h = 0x811c9dc5;
  for (const b of utf8Encode(teamId)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

class Out {
  private parts: number[] = [];
  u8(v: number) {
    this.parts.push(v & 255);
  }
  u16(v: number) {
    this.parts.push((v >>> 8) & 255, v & 255);
  }
  u32(v: number) {
    this.parts.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  }
  i32(v: number) {
    this.u32(v >>> 0);
  }
  f64(v: number) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v);
    this.raw(b);
  }
  raw(b: Uint8Array) {
    for (const x of b) this.parts.push(x);
  }
  str(s: string, max: number) {
    const b = utf8Clip(s, max);
    this.u8(b.length);
    this.raw(b);
  }
  done(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

class In {
  private i = 0;
  private b: Uint8Array;
  private view: DataView;
  constructor(b: Uint8Array) {
    this.b = b;
    this.view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  private need(n: number) {
    if (this.i + n > this.b.length) throw new Error('short');
  }
  u8() {
    this.need(1);
    return this.b[this.i++];
  }
  u16() {
    this.need(2);
    const v = this.view.getUint16(this.i);
    this.i += 2;
    return v;
  }
  u32() {
    this.need(4);
    const v = this.view.getUint32(this.i);
    this.i += 4;
    return v;
  }
  i32() {
    this.need(4);
    const v = this.view.getInt32(this.i);
    this.i += 4;
    return v;
  }
  f64() {
    this.need(8);
    const v = this.view.getFloat64(this.i);
    this.i += 8;
    return v;
  }
  str() {
    const n = this.u8();
    this.need(n);
    const s = utf8Decode(this.b.subarray(this.i, this.i + n));
    this.i += n;
    return s;
  }
  rest() {
    const r = this.b.subarray(this.i);
    this.i = this.b.length;
    return r;
  }
}

/** One envelope as bytes (may be longer than a packet; see `fragment`). */
export function encodeEnvelope(e: Envelope, teamId: string): Uint8Array {
  const o = new Out();
  o.u8(MAGIC);
  o.u8((VERSION << 4) | KINDS.indexOf(e.kind));
  o.u32(teamHash(teamId));
  o.f64(e.t);
  o.u8(Math.min(255, e.hops));
  if (e.kind === 'pos') {
    const p = e.body;
    o.str(p.uid, 40);
    o.str(p.callsign, 24);
    o.u8(Math.max(0, ROLE_ORDER.indexOf(p.role)));
    o.u8(Math.max(0, STATUSES.indexOf(p.status)) | (p.cmd ? 0x10 : 0));
    o.i32(Math.round(p.lat * 1e7));
    o.i32(Math.round(p.lng * 1e7));
    o.u16(p.heading == null ? NONE16 : Math.round(((p.heading % 360) + 360) % 360));
    o.u16(p.accuracy == null ? NONE16 : Math.min(NONE16 - 1, Math.round(p.accuracy)));
  } else {
    o.raw(utf8Encode(JSON.stringify(e.body)));
  }
  return o.done();
}

/** Back to an envelope of our squad; anything else (or garbage) gives null. */
export function decodeEnvelope(b: Uint8Array, teamId: string): Envelope | null {
  try {
    const r = new In(b);
    if (r.u8() !== MAGIC) return null;
    const vk = r.u8();
    if (vk >> 4 !== VERSION) return null;
    const kind = KINDS[vk & 15];
    if (!kind || r.u32() !== teamHash(teamId)) return null;
    const t = r.f64();
    const hops = r.u8();
    let e: Envelope;
    if (kind === 'pos') {
      const uid = r.str();
      const callsign = r.str();
      const role = roleOf(ROLE_ORDER[r.u8()]);
      const sc = r.u8();
      const lat = r.i32() / 1e7;
      const lng = r.i32() / 1e7;
      const heading = r.u16();
      const accuracy = r.u16();
      const body: MeshPos = {
        uid,
        callsign,
        role,
        status: STATUSES[sc & 15] ?? 'alive',
        cmd: (sc & 0x10) !== 0,
        lat,
        lng,
        heading: heading === NONE16 ? null : heading,
        accuracy: accuracy === NONE16 ? null : accuracy,
      };
      e = posEnvelope(teamId, body, t);
    } else {
      const body = JSON.parse(utf8Decode(r.rest()));
      e =
        kind === 'chat'
          ? chatEnvelope(teamId, body, t)
          : kind === 'mark'
            ? markEnvelope(teamId, body, t)
            : voteEnvelope(teamId, body, t);
    }
    e = { ...e, hops } as Envelope;
    return validEnvelope(e) ? e : null;
  } catch {
    return null;
  }
}

/** Splits bytes into packets of at most MAX_PAYLOAD; null when it would take too many. */
export function fragment(b: Uint8Array, messageId: number, max = MAX_PAYLOAD): Uint8Array[] | null {
  if (b.length <= max) return [b];
  const chunk = max - FRAG_HEADER;
  const count = Math.ceil(b.length / chunk);
  if (count > MAX_FRAGMENTS) return null;
  const out: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const part = b.subarray(i * chunk, (i + 1) * chunk);
    const p = new Uint8Array(FRAG_HEADER + part.length);
    p[0] = MAGIC;
    p[1] = FRAG;
    p[2] = (messageId >>> 8) & 255;
    p[3] = messageId & 255;
    p[4] = i;
    p[5] = count;
    p.set(part, FRAG_HEADER);
    out.push(p);
  }
  return out;
}

/** Puts fragments back together, per sending radio; incomplete ones expire. */
export class Reassembler {
  private parts = new Map<string, { at: number; count: number; chunks: (Uint8Array | undefined)[] }>();

  private ttlMs: number;

  constructor(ttlMs = 120_000) {
    this.ttlMs = ttlMs;
  }

  /** A whole message when this packet completes one (or wasn't a fragment at all). */
  push(from: number, b: Uint8Array, now: number): Uint8Array | null {
    if (b.length < 2 || b[0] !== MAGIC) return null;
    if (b[1] !== FRAG) return b.length >= HEADER ? b : null;
    if (b.length < FRAG_HEADER) return null;
    for (const [k, v] of this.parts) if (now - v.at > this.ttlMs) this.parts.delete(k);
    const key = `${from}:${(b[2] << 8) | b[3]}`;
    const idx = b[4];
    const count = b[5];
    if (!count || count > MAX_FRAGMENTS || idx >= count) return null;
    let entry = this.parts.get(key);
    if (!entry || entry.count !== count) {
      // Filled, not sparse: `some` skips holes.
      entry = { at: now, count, chunks: Array.from({ length: count }, () => undefined) };
      this.parts.set(key, entry);
    }
    entry.chunks[idx] = b.slice(FRAG_HEADER);
    if (entry.chunks.some((c) => !c)) return null;
    this.parts.delete(key);
    const total = entry.chunks.reduce((n, c) => n + c!.length, 0);
    const whole = new Uint8Array(total);
    let off = 0;
    for (const c of entry.chunks) {
      whole.set(c!, off);
      off += c!.length;
    }
    return whole;
  }
}

/**
 * Packets waiting for the air, one at a time with a pause between them (a full packet
 * takes ~1.5 s of airtime on LongFast). Chat, markers and votes go before positions,
 * and a fighter's queued position is replaced by a newer one instead of piling up.
 */
export class RadioOutbox {
  private queue: { key: string; prio: number; seq: number; frames: Uint8Array[] }[] = [];
  private seq = 0;
  private lastTx = -Infinity;
  private gapMs: number;

  constructor(gapMs = 2500) {
    this.gapMs = gapMs;
  }

  push(e: Envelope, frames: Uint8Array[]) {
    const key = e.kind === 'pos' ? `pos:${e.body.uid}` : e.id;
    this.queue = this.queue.filter((q) => q.key !== key);
    this.queue.push({ key, prio: e.kind === 'pos' ? 1 : 0, seq: this.seq++, frames: [...frames] });
    // Bounded: drop the oldest positions first when the air can't keep up.
    while (this.queue.length > 60) {
      const i = this.queue.findIndex((q) => q.prio === 1);
      this.queue.splice(i >= 0 ? i : 0, 1);
    }
  }

  /** The next packet to transmit, if the pause since the last one has passed. */
  next(now: number): Uint8Array | null {
    if (now - this.lastTx < this.gapMs || !this.queue.length) return null;
    this.queue.sort((a, b) => a.prio - b.prio || a.seq - b.seq);
    const head = this.queue[0];
    const frame = head.frames.shift()!;
    if (!head.frames.length) this.queue.shift();
    this.lastTx = now;
    return frame;
  }

  get size(): number {
    return this.queue.length;
  }

  clear() {
    this.queue = [];
  }
}
