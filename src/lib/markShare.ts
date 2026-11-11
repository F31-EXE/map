/**
 * Markers and routes handed from phone to phone without any network: the sender's
 * screen cycles through a few QR codes, the receiver's camera collects them.
 *
 * Each code: `GMK1:<set>:<i>:<n>:<chunk>`; the chunks joined are JSON
 * `[[kind, label, lat, lng, points?, color?], …]` (ASCII, \u escapes), coordinates rounded to ~1 m.
 */

export type SharedMark = {
  kind: string;
  label: string;
  lat: number;
  lng: number;
  points?: { lat: number; lng: number }[];
  color?: string;
};

const PREFIX = 'GMK1';
/** Characters per code: small enough for a dense-but-readable QR on a phone screen. */
export const CHUNK = 400;
export const MAX_MARKS = 300;

const r5 = (x: number) => Math.round(x * 1e5) / 1e5;

/** Short hash of the content: the same markers give the same codes. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function encodeMarks(marks: SharedMark[], set?: string): string[] {
  const rows = marks.slice(0, MAX_MARKS).map((m) => {
    const row: unknown[] = [m.kind, m.label.slice(0, 60), r5(m.lat), r5(m.lng)];
    if (m.points?.length || m.color) row.push(m.points?.map((p) => [r5(p.lat), r5(p.lng)]) ?? 0);
    if (m.color) row.push(m.color);
    return row;
  });
  // ASCII only (Cyrillic as \uXXXX, which JSON.parse reads back): QR byte mode and
  // scanners then agree on every character.
  const json = JSON.stringify(rows).replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  set = set ?? hash(json);
  const n = Math.max(1, Math.ceil(json.length / CHUNK));
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(`${PREFIX}:${set}:${i + 1}:${n}:${json.slice(i * CHUNK, (i + 1) * CHUNK)}`);
  return out;
}

export const isMarksCode = (text: string): boolean => text.startsWith(PREFIX + ':');

const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);

function decode(json: string): SharedMark[] | null {
  let rows: unknown;
  try {
    rows = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  const out: SharedMark[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || typeof r[0] !== 'string' || !num(r[2]) || !num(r[3])) continue;
    const m: SharedMark = { kind: r[0], label: typeof r[1] === 'string' ? r[1] : '', lat: r[2], lng: r[3] };
    if (Array.isArray(r[4])) {
      const pts = r[4]
        .filter((p: unknown) => Array.isArray(p) && num(p[0]) && num(p[1]))
        .map((p: number[]) => ({ lat: p[0], lng: p[1] }));
      if (pts.length) m.points = pts;
    }
    if (typeof r[5] === 'string') m.color = r[5];
    out.push(m);
  }
  return out;
}

/** Collects the codes of one set, in any order, repeats ignored. */
export class MarksCollector {
  private set: string | null = null;
  private parts: (string | undefined)[] = [];

  /** `{got, total}` while collecting, plus `marks` once complete; null for a foreign QR. */
  push(text: string): { got: number; total: number; marks?: SharedMark[] } | null {
    const m = /^GMK1:([^:]+):(\d+):(\d+):([\s\S]*)$/.exec(text);
    if (!m) return null;
    const [, set, iStr, nStr, chunk] = m;
    const i = Number(iStr);
    const n = Number(nStr);
    if (!(n >= 1 && n <= 200 && i >= 1 && i <= n)) return null;
    if (set !== this.set || this.parts.length !== n) {
      this.set = set;
      this.parts = new Array(n).fill(undefined);
    }
    this.parts[i - 1] = chunk;
    const got = this.parts.filter((p) => p != null).length;
    if (got < n) return { got, total: n };
    const marks = decode(this.parts.join(''));
    return marks ? { got, total: n, marks } : { got: 0, total: n };
  }
}
