/** Battery of a fighter's phone and radio, for the map, the member card and the HQ. */
export type Power = { battery?: number | null; charging?: boolean; radioBattery?: number | null };

/** Below this a phone or radio is about to drop off. */
export const LOW_BATTERY = 20;

/** Meshtastic reports 101 for a radio on external power. */
const RADIO_POWERED = 101;

export function lowPower(p: Power): boolean {
  const phoneLow = p.battery != null && p.battery < LOW_BATTERY && !p.charging;
  const radioLow = p.radioBattery != null && p.radioBattery < LOW_BATTERY;
  return phoneLow || radioLow;
}

/** «телефон 45 % · рация 80 %», or null when nothing is known. */
export function powerText(p: Power): string | null {
  const parts: string[] = [];
  if (p.battery != null) parts.push(`телефон ${p.battery} %${p.charging ? ' ⚡' : ''}`);
  if (p.radioBattery != null) parts.push(p.radioBattery >= RADIO_POWERED ? 'рация от сети' : `рация ${p.radioBattery} %`);
  return parts.length ? parts.join(' · ') : null;
}
