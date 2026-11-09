/**
 * Just enough protobuf wire format for the Meshtastic phone API (src/lib/meshtastic.ts):
 * varints, fixed32, length-delimited fields. No schema, no codegen; also UTF-8 helpers,
 * since Hermes' TextDecoder can't be relied on.
 */

export const Wire = { Varint: 0, Fixed64: 1, Len: 2, Fixed32: 5 } as const;
export type Wire = (typeof Wire)[keyof typeof Wire];

export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function utf8Decode(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; ) {
    const c = b[i++];
    let cp: number;
    if (c < 0x80) cp = c;
    else if (c >= 0xf0) cp = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    else if (c >= 0xe0) cp = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    else if (c >= 0xc0) cp = ((c & 31) << 6) | (b[i++] & 63);
    else cp = 0xfffd;
    s += String.fromCodePoint(cp);
  }
  return s;
}

/** Cuts a string so its UTF-8 form fits in `max` bytes, never inside a character. */
export function utf8Clip(s: string, max: number): Uint8Array {
  const b = utf8Encode(s);
  if (b.length <= max) return b;
  let n = max;
  while (n > 0 && (b[n] & 0xc0) === 0x80) n--;
  return b.slice(0, n);
}

export class Writer {
  private bytes: number[] = [];

  private varint(v: number) {
    // Unsigned only (all we send); safe up to 2^53.
    if (v < 0 || !Number.isFinite(v)) throw new Error(`varint ${v}`);
    while (v > 0x7f) {
      this.bytes.push((v % 128) | 0x80);
      v = Math.floor(v / 128);
    }
    this.bytes.push(v);
  }

  private tag(field: number, wire: Wire) {
    this.varint(field * 8 + wire);
  }

  uint(field: number, v: number): this {
    this.tag(field, Wire.Varint);
    this.varint(v);
    return this;
  }

  bool(field: number, v: boolean): this {
    return v ? this.uint(field, 1) : this;
  }

  fixed32(field: number, v: number): this {
    this.tag(field, Wire.Fixed32);
    const u = v >>> 0;
    this.bytes.push(u & 255, (u >>> 8) & 255, (u >>> 16) & 255, u >>> 24);
    return this;
  }

  bytesField(field: number, b: Uint8Array): this {
    this.tag(field, Wire.Len);
    this.varint(b.length);
    for (const x of b) this.bytes.push(x);
    return this;
  }

  string(field: number, s: string): this {
    return this.bytesField(field, utf8Encode(s));
  }

  message(field: number, m: Writer): this {
    return this.bytesField(field, m.finish());
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

export type Field = { wire: Wire; num: number; bytes: Uint8Array | null };

/** Fields of one message by number, in order; unknown wire types end the parse. */
export class Fields {
  private map = new Map<number, Field[]>();

  constructor(buf: Uint8Array) {
    let i = 0;
    const varint = () => {
      let v = 0;
      let mul = 1;
      for (;;) {
        if (i >= buf.length) throw new Error('truncated varint');
        const b = buf[i++];
        v += (b & 0x7f) * mul;
        if (b < 0x80) return v;
        mul *= 128;
      }
    };
    while (i < buf.length) {
      const key = varint();
      const no = Math.floor(key / 8);
      const wire = (key & 7) as Wire;
      let f: Field;
      if (wire === Wire.Varint) f = { wire, num: varint(), bytes: null };
      else if (wire === Wire.Fixed32) {
        if (i + 4 > buf.length) throw new Error('truncated fixed32');
        f = { wire, num: (buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24)) >>> 0, bytes: buf.slice(i, i + 4) };
        i += 4;
      } else if (wire === Wire.Fixed64) {
        f = { wire, num: 0, bytes: buf.slice(i, i + 8) };
        i += 8;
      } else if (wire === Wire.Len) {
        const n = varint();
        if (i + n > buf.length) throw new Error('truncated field');
        f = { wire, num: n, bytes: buf.slice(i, i + n) };
        i += n;
      } else throw new Error(`wire type ${wire}`);
      const list = this.map.get(no);
      if (list) list.push(f);
      else this.map.set(no, [f]);
    }
  }

  has(no: number): boolean {
    return this.map.has(no);
  }

  /** varint, fixed32 or bool; the last occurrence wins, as in protobuf. */
  uint(no: number, fallback = 0): number {
    const l = this.map.get(no);
    return l ? l[l.length - 1].num : fallback;
  }

  /** int32 / sfixed32 read back as signed. */
  int(no: number, fallback = 0): number {
    const l = this.map.get(no);
    if (!l) return fallback;
    const v = l[l.length - 1].num;
    // A negative varint int32 arrives as a huge unsigned number.
    return v >= 2 ** 31 ? (v % 2 ** 32) - 2 ** 32 : v;
  }

  float(no: number): number | null {
    const l = this.map.get(no);
    const b = l?.[l.length - 1].bytes;
    if (!b || b.length !== 4) return null;
    return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true);
  }

  bytes(no: number): Uint8Array | null {
    const l = this.map.get(no);
    return l ? l[l.length - 1].bytes : null;
  }

  string(no: number): string {
    const b = this.bytes(no);
    return b ? utf8Decode(b) : '';
  }

  message(no: number): Fields | null {
    const b = this.bytes(no);
    return b ? new Fields(b) : null;
  }
}
