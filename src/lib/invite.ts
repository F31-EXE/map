/**
 * Invite links carried in QR codes. A squad QR joins a fighter to the squad; a side QR
 * attaches a squad (scanned by its leader) to a side commander's side.
 *
 *   grimmap://join?team=K7QX2M
 *   grimmap://join?side=P4MZ8A
 *
 * Scanned with the in-app scanner, or with the phone's camera, which opens the app on
 * the /join route. A bare 6-character code is read as a squad code.
 */
export type Invite = { kind: 'team' | 'side'; code: string };

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function inviteUrl(invite: Invite): string {
  return `grimmap://join?${invite.kind}=${encodeURIComponent(invite.code)}`;
}

export function parseInvite(text: string): Invite | null {
  const raw = text.trim();
  const query = /^grimmap:\/*join\/?\?(.*)$/i.exec(raw);
  if (query) {
    for (const part of query[1].split('&')) {
      const [key, value = ''] = part.split('=');
      const code = normalizeCode(decodeURIComponent(value));
      if ((key === 'team' || key === 'side') && code.length >= 4) return { kind: key, code };
    }
    return null;
  }
  const code = normalizeCode(raw);
  return code.length === 6 && code === raw.toUpperCase() ? { kind: 'team', code } : null;
}
