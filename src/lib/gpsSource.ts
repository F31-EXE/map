/**
 * Where my own position comes from: the phone's GPS or the Meshtastic radio's (often
 * with a better, external antenna). Pure, so the choice is tested.
 */
export type GpsMode = 'phone' | 'auto' | 'radio';
export type GpsSrc = 'phone' | 'radio';

export const GPS_MODES: { id: GpsMode; title: string }[] = [
  { id: 'phone', title: 'Телефон' },
  { id: 'auto', title: 'Авто' },
  { id: 'radio', title: 'Рация' },
];

export type PhoneFix = { lat: number; lng: number; accuracy: number | null; timestamp: number };
/** A fix from the radio; `at` = when this phone got a new one, `accuracy` estimated (m). */
export type RadioFix = { lat: number; lng: number; accuracy: number | null; at: number };

/** The phone's fix is current (it reports every ~2 s). */
export const PHONE_FRESH_MS = 15_000;
/** Phone mode keeps using the phone until its fix is this old, then the radio's. */
const PHONE_FALLBACK_MS = 60_000;
/** A radio fix this old is still used when nothing better exists (laptops). */
const RADIO_FALLBACK_MS = 10 * 60_000;
/** Radio fix accuracy assumed when the radio doesn't report its DOP. */
export const RADIO_ACCURACY_GUESS = 8;
/** Auto switches only when the other source is clearly (this much) better. */
const MARGIN = 1.3;

/**
 * Which fix to use. `radioFreshMs` is how old a radio fix may be and still count as
 * live (depends on how often the radio is polled). `current` is the last choice, kept
 * unless the other source is clearly better, so the dot doesn't flip between two fixes
 * a few metres apart.
 */
export function pickGps(
  mode: GpsMode,
  phone: PhoneFix | null,
  radio: RadioFix | null,
  now: number,
  radioFreshMs: number,
  current: GpsSrc | null = null
): GpsSrc | null {
  const phoneAge = phone ? now - phone.timestamp : Infinity;
  const radioAge = radio ? now - radio.at : Infinity;
  const phoneLive = phoneAge < PHONE_FRESH_MS;
  const radioLive = radioAge < radioFreshMs;

  if (mode === 'phone') {
    if (phoneAge < PHONE_FALLBACK_MS) return 'phone';
    if (radioAge < RADIO_FALLBACK_MS) return 'radio';
    return phone ? 'phone' : null;
  }
  if (mode === 'radio') {
    if (radioLive) return 'radio';
    if (phone) return 'phone';
    return radioAge < RADIO_FALLBACK_MS ? 'radio' : null;
  }
  // auto
  if (phoneLive && radioLive) {
    const p = phone!.accuracy ?? 50;
    const r = radio!.accuracy ?? RADIO_ACCURACY_GUESS;
    if (current === 'radio') return p * MARGIN < r ? 'phone' : 'radio';
    return r * MARGIN < p ? 'radio' : 'phone';
  }
  if (radioLive) return 'radio';
  if (phoneAge < PHONE_FALLBACK_MS) return 'phone';
  if (radioAge < RADIO_FALLBACK_MS) return 'radio';
  return phone ? 'phone' : null;
}

/** How often to ask the radio for its node list (our position first): more nodes, rarer. */
export function radioPollMs(nodes: number): number {
  return Math.min(30_000, Math.max(5_000, nodes * 80));
}

/** «GPS рации ±4 м» / «GPS телефона» for member cards. */
export function gpsSrcText(src: GpsSrc | null | undefined, accuracy?: number | null): string | null {
  if (!src) return null;
  const acc = accuracy != null ? ` ±${Math.round(accuracy)} м` : '';
  return `${src === 'radio' ? 'GPS рации' : 'GPS телефона'}${acc}`;
}
