/** Team tag shown before the callsign: «[GRIM] Гром». Up to 5 characters, no brackets or spaces. */
export const TAG_MAX = 5;

export function cleanTag(s: string): string {
  return s.replace(/[\[\]\s]/g, '').slice(0, TAG_MAX);
}

export function withTag(callsign: string, tag?: string | null): string {
  return tag ? `[${tag}] ${callsign}` : callsign;
}
