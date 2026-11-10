/**
 * Meshtastic's serial (USB) stream: each protobuf is framed as 0x94 0xC3, a 2-byte
 * big-endian length, then the bytes. Between frames the radio may print debug text.
 */
const START1 = 0x94;
export const START2 = 0xc3;
const MAX_FRAME = 512;

/** Splits Meshtastic's serial stream into protobuf frames; debug text between them is skipped. */
export class FrameParser {
  private buf = new Uint8Array(0);

  push(chunk: Uint8Array): Uint8Array[] {
    const joined = new Uint8Array(this.buf.length + chunk.length);
    joined.set(this.buf);
    joined.set(chunk, this.buf.length);
    let b = joined;
    const out: Uint8Array[] = [];
    for (;;) {
      const start = b.findIndex((x, i) => x === START1 && b[i + 1] === START2);
      if (start < 0) {
        // Keep a trailing START1: its START2 may be in the next chunk.
        b = b.length && b[b.length - 1] === START1 ? b.slice(-1) : new Uint8Array(0);
        break;
      }
      if (b.length < start + 4) {
        b = b.slice(start);
        break;
      }
      const len = (b[start + 2] << 8) | b[start + 3];
      if (len > MAX_FRAME) {
        // Not a real header (random log bytes): look further.
        b = b.slice(start + 1);
        continue;
      }
      if (b.length < start + 4 + len) {
        b = b.slice(start);
        break;
      }
      out.push(b.slice(start + 4, start + 4 + len));
      b = b.slice(start + 4 + len);
    }
    this.buf = b;
    return out;
  }
}

export function frame(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length + 4);
  out[0] = START1;
  out[1] = START2;
  out[2] = (bytes.length >> 8) & 0xff;
  out[3] = bytes.length & 0xff;
  out.set(bytes, 4);
  return out;
}

