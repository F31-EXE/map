// Generates assets/sounds/order.wav: a short two-tone "new order" chirp.
// Kept as a script so the sound can be tweaked without binary tooling.
import { writeFileSync } from 'node:fs';

const RATE = 22050;
const tones = [
  [880, 0.11],
  [0, 0.04],
  [1320, 0.16],
];
const samples = [];
for (const [freq, dur] of tones) {
  const n = Math.round(RATE * dur);
  for (let i = 0; i < n; i++) {
    // 8 ms fade in/out to avoid clicks.
    const env = Math.min(1, i / (RATE * 0.008), (n - i) / (RATE * 0.008));
    samples.push(freq ? Math.sin((2 * Math.PI * freq * i) / RATE) * env * 0.6 : 0);
  }
}
const data = Buffer.alloc(samples.length * 2);
samples.forEach((s, i) => data.writeInt16LE(Math.round(s * 32767), i * 2));
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);
writeFileSync(new URL('../assets/sounds/order.wav', import.meta.url), Buffer.concat([header, data]));
