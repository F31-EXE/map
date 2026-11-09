/**
 * Invite links carried in QR codes. A squad QR joins a fighter to the squad; a side QR
 * attaches a squad (scanned by its leader) to a side commander's side. Big games: a
 * tech QR makes another game tech, a game-side QR brings a commander's side into the
 * game, a claim QR hands a side a tech made over to its commander.
 *
 *   grimmap://join?team=K7QX2M
 *   grimmap://join?side=P4MZ8A
 *   grimmap://join?game=T3CH42           (game tech)
 *   grimmap://join?gameside=S1DE42       (side commander → game)
 *   grimmap://join?claim=ABCDEF123456&sid=<sideId>
 *
 * Scanned with the in-app scanner, or with the phone's camera, which opens the app on
 * the /join route. A bare 6-character code is read as a squad code.
 */
export type Invite =
  | { kind: 'team' | 'side' | 'game' | 'gameside'; code: string }
  | { kind: 'claim'; code: string; sideId: string };

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function inviteUrl(invite: Invite): string {
  const base = `grimmap://join?${invite.kind}=${encodeURIComponent(invite.code)}`;
  return invite.kind === 'claim' ? `${base}&sid=${encodeURIComponent(invite.sideId)}` : base;
}

export function parseInvite(text: string): Invite | null {
  const raw = text.trim();
  const query = /^grimmap:\/*join\/?\?(.*)$/i.exec(raw);
  if (query) {
    const params = new Map(
      query[1].split('&').map((part) => {
        const [key, value = ''] = part.split('=');
        return [key, decodeURIComponent(value)] as const;
      })
    );
    const claim = normalizeCode(params.get('claim') ?? '');
    const sid = (params.get('sid') ?? '').replace(/[^A-Za-z0-9]/g, '');
    if (claim.length >= 4 && sid) return { kind: 'claim', code: claim, sideId: sid };
    for (const key of ['team', 'side', 'game', 'gameside'] as const) {
      const code = normalizeCode(params.get(key) ?? '');
      if (code.length >= 4) return { kind: key, code };
    }
    return null;
  }
  const code = normalizeCode(raw);
  return code.length === 6 && code === raw.toUpperCase() ? { kind: 'team', code } : null;
}
