/** Base64 <-> bytes without Buffer or atob (not in every React Native runtime). */
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Map([...ABC].map((c, i) => [c, i]));

export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += ABC[(n >> 18) & 63] + ABC[(n >> 12) & 63];
    s += i + 1 < b.length ? ABC[(n >> 6) & 63] : '=';
    s += i + 2 < b.length ? ABC[n & 63] : '=';
  }
  return s;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      ((LOOKUP.get(clean[i]) ?? 0) << 18) |
      ((LOOKUP.get(clean[i + 1]) ?? 0) << 12) |
      ((LOOKUP.get(clean[i + 2]) ?? 0) << 6) |
      (LOOKUP.get(clean[i + 3]) ?? 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
