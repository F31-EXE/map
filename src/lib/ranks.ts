/**
 * Chain of command for markers: side commander > squad commander (squad creator) >
 * sergeant (member granted command rights) > fighter. You may delete your own markers
 * and those of anyone strictly below you. Mirrors `rank()` in firestore.rules.
 */
export const RANK = { fighter: 1, sergeant: 2, squadCommander: 3, sideCommander: 4 } as const;

export type RankContext = {
  /** Squad creator. */
  ownerId: string | null | undefined;
  /** Commander of the side the squad is attached to. */
  sideOwnerId: string | null | undefined;
  /** Members holding command rights. */
  commanders: ReadonlySet<string>;
};

export function rankOf(uid: string | null | undefined, ctx: RankContext): number {
  if (!uid) return 0;
  if (ctx.sideOwnerId && uid === ctx.sideOwnerId) return RANK.sideCommander;
  if (ctx.ownerId && uid === ctx.ownerId) return RANK.squadCommander;
  if (ctx.commanders.has(uid)) return RANK.sergeant;
  return RANK.fighter;
}

export function canDeleteMarker(
  me: string | null | undefined,
  marker: { createdBy: string; personal?: boolean },
  ctx: RankContext
): boolean {
  if (marker.personal) return true;
  if (!me) return false;
  return marker.createdBy === me || rankOf(me, ctx) > rankOf(marker.createdBy, ctx);
}

export const RANK_TITLES: Record<number, string> = {
  1: 'боец',
  2: 'старшина',
  3: 'командир отряда',
  4: 'командир стороны',
};
