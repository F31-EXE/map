/**
 * SOS ("нужна помощь") rides in the squad chat as a message with a fixed text, so it
 * reaches everyone by every path chat already takes (server, Nearby, LoRa radio) and
 * older app versions still show it as a readable message.
 *
 *   🆘 SOS: нужна помощь · 56.83812, 60.60351
 *   ✅ SOS снят
 */

export const SOS_TTL_MS = 15 * 60_000;
const SOS_RE = /^🆘 SOS[^·]*·\s*(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/u;
const CANCEL = '✅ SOS снят';

export function sosText(lat: number, lng: number): string {
  return `🆘 SOS: нужна помощь · ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export const sosCancelText = (): string => CANCEL;

export function parseSos(text: string): { lat: number; lng: number } | null {
  const m = SOS_RE.exec(text.trim());
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export const isSosCancel = (text: string): boolean => text.trim().startsWith(CANCEL);

export type SosCall = { id: string; uid: string; callsign: string; lat: number; lng: number; at: number };

/** Calls still open: the latest SOS per fighter, not cancelled after it and not older than the TTL. */
export function activeSos(
  messages: { id: string; uid: string; callsign: string; text: string; createdAt: number }[],
  now: number
): SosCall[] {
  const last = new Map<string, SosCall | null>();
  const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  for (const m of sorted) {
    if (isSosCancel(m.text)) {
      last.set(m.uid, null);
      continue;
    }
    const p = parseSos(m.text);
    if (p) last.set(m.uid, { id: m.id, uid: m.uid, callsign: m.callsign, lat: p.lat, lng: p.lng, at: m.createdAt });
  }
  const out: SosCall[] = [];
  for (const c of last.values()) if (c && now - c.at < SOS_TTL_MS) out.push(c);
  return out.sort((a, b) => b.at - a.at);
}
