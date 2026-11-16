import type { Unsubscribe } from 'firebase/firestore';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { Invite } from '../lib/invite';
import { isVotedOut } from '../lib/markerKinds';
import { canDeleteMarker, rankOf, type RankContext } from '../lib/ranks';
import { KEYS, loadJson, saveJson } from '../lib/storage';
import type { Deputy, DeputyPerm, Direction, HqPerson, Member, OrderKind, Side, TacMarker, Team } from '../lib/types';
import * as sides from '../services/sides';
import * as teams from '../services/teams';
import { useSession } from './session';
import { withTimeout } from '../lib/firebase';
import { DEFAULT_ROLE } from '../lib/roles';

/** What the stars on a map mark say. */
export const STAR_TITLES: Record<0 | 1 | 2 | 3, string> = {
  0: '',
  1: 'командир направления',
  2: 'зам. КС',
  3: 'командир стороны',
};

export type Squad = Team & {
  /** Color the side commander sees it in (local override or the squad's own). */
  displayColor: string;
  members: Member[];
  leaderName: string | null;
};

/** 'own' = my squad's fighters (squad order); 'all' or a team id = side order to squad commanders. */
export type OrderTarget = 'own' | 'all' | string;

type SideState = {
  /** The side I command, serve at (deputy, direction commander) or sit in the HQ of. */
  side: Side | null;
  /** The side's commander, or one of the deputies they named: the side's command post. */
  isSideCommander: boolean;
  /** Deputy named by the side commander (not the commander themselves). */
  isDeputy: boolean;
  /** The side's commander themselves. */
  isSideOwner: boolean;
  /** What I may do at the side: everything for the commander, the given rights for a deputy. */
  can: (perm: DeputyPerm) => boolean;
  /** I lead a direction (several squads), and which one. */
  isDirCommander: boolean;
  myDirection: (Direction & { id: string }) | null;
  /** I see squads beyond my own: the command post (all) or a direction commander (theirs). */
  commandsSquads: boolean;
  /** Stars on the map: 3 side commander, 2 deputy, 1 direction commander. */
  starsOf: (uid: string) => 0 | 1 | 2 | 3;
  /** People in the side's HQ (joined with the HQ code). */
  hq: HqPerson[];
  /** I joined a side's HQ with its code (and wait for / have a role there). */
  inHq: boolean;
  /** Names / removes a deputy with rights (commander only). */
  setDeputy: (uid: string, d: Deputy | null) => Promise<void>;
  /** Directions with their commanders (commander, or a deputy with the 'directions' right). */
  saveDirections: (directions: Record<string, Direction>) => Promise<void>;
  /** The HQ invite code (made on first use). */
  hqCode: () => Promise<string>;
  leaveHq: () => Promise<void>;
  /** A direction commander lets a squad go from the direction. */
  releaseSquad: (teamId: string) => Promise<void>;
  squads: Squad[];
  /** Side map filter: every fighter, or squad commanders only. */
  showAll: boolean;
  setShowAll: (v: boolean) => Promise<void>;
  setSquadColor: (teamId: string, color: string | null) => Promise<void>;
  createSide: (name: string) => Promise<void>;
  resign: () => Promise<void>;
  /** Become this side's commander locally (after taking over a side a game tech made). */
  adoptSide: (sideId: string) => Promise<void>;
  dropSquad: (teamId: string) => Promise<void>;

  /** Side my own squad is attached to (shown to its members). */
  mySquadSide: Side | null;
  attachMySquad: (code: string) => Promise<void>;
  detachMySquad: () => Promise<void>;

  /** Everything to draw: own squad + side squads, personal and visible markers. */
  mapMembers: Member[];
  mapMarkers: TacMarker[];

  placeOrder: (
    o: { kind: OrderKind; label: string; lat: number; lng: number },
    target: OrderTarget
  ) => Promise<void>;
  deleteMarker: (m: TacMarker) => Promise<void>;
  /** Chain of command: own markers and those of anyone below me. */
  canDelete: (m: TacMarker) => boolean;
  /** My rank in my own squad (see src/lib/ranks.ts). */
  myRank: number;
  /** Handles a scanned or opened invite link. */
  acceptInvite: (invite: Invite) => Promise<string>;
};

const Ctx = createContext<SideState | null>(null);

export function useSide(): SideState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSide must be used inside <SideProvider>');
  return v;
}

export function SideProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const { uid, teamId, team, members, isOwner, teamColor, markers, callsign } = session;

  const [ownSideId, setSideId] = useState<string | null>(null);
  const [side, setSide] = useState<Side | null>(null);
  const [sideTeams, setSideTeams] = useState<Team[]>([]);
  const [sideMembers, setSideMembers] = useState<Record<string, Member[]>>({});
  const [sideMarkers, setSideMarkers] = useState<Record<string, TacMarker[]>>({});
  const [colors, setColors] = useState<Record<string, string>>({});
  const [showAll, setShowAllState] = useState(true);
  const [mySquadSide, setMySquadSide] = useState<Side | null>(null);
  const [hqSideId, setHqSideId] = useState<string | null>(null);
  const [hq, setHq] = useState<HqPerson[]>([]);

  useEffect(() => {
    (async () => {
      setHqSideId(await loadJson<string | null>(KEYS.hqSide, null));
      setSideId(await loadJson<string | null>(KEYS.sideId, null));
      setColors(await loadJson<Record<string, string>>(KEYS.sideColors, {}));
      setShowAllState(await loadJson<boolean>(KEYS.sideShowAll, true));
    })();
  }, []);

  // Which side I serve at: the one I command (kept locally), the one whose HQ I joined
  // with its code, or (older way) the one my squad is on when its commander named me deputy
  // or direction commander there.
  const servesInSquadSide =
    mySquadSide && uid && (mySquadSide.deputies?.[uid] || Object.values(mySquadSide.directions ?? {}).some((d) => d.cmd === uid))
      ? mySquadSide.id
      : null;
  const sideId = ownSideId ?? hqSideId ?? servesInSquadSide;

  useEffect(() => {
    if (!sideId || !uid) {
      setSide(null);
      return;
    }
    return sides.subscribeSide(sideId, setSide, () => {});
  }, [sideId, uid]);

  // My place at the side, from its doc.
  const isSideOwner = Boolean(side && uid && side.ownerId === uid);
  const isDeputy = Boolean(side && uid && !isSideOwner && side.deputies?.[uid]);
  const isSideCommander = isSideOwner || isDeputy;
  const myDirection = useMemo(() => {
    if (!side || !uid || isSideCommander) return null;
    const e = Object.entries(side.directions ?? {}).find(([, d]) => d.cmd === uid);
    return e ? { id: e[0], ...e[1] } : null;
  }, [side, uid, isSideCommander]);
  const isDirCommander = Boolean(myDirection);
  const commandsSquads = isSideCommander || isDirCommander;
  // Squads I see: all of the side's for the command post, a direction commander's own.
  const scope = isSideCommander ? 'all' : myDirection ? `dir:${myDirection.id}` : null;

  // The squads in my scope, and each squad's roster and markers.
  useEffect(() => {
    if (!sideId || !uid || !scope) {
      setSideTeams([]);
      setSideMembers({});
      setSideMarkers({});
      return;
    }
    const perTeam = new Map<string, Unsubscribe[]>();
    const drop = (id: string) => {
      perTeam.get(id)?.forEach((u) => u());
      perTeam.delete(id);
      setSideMembers(({ [id]: _, ...rest }) => rest);
      setSideMarkers(({ [id]: _, ...rest }) => rest);
    };
    const ignore = () => {};
    const onTeams = (list: Team[]) => {
        setSideTeams(list);
        const ids = new Set(list.map((t) => t.id));
        [...perTeam.keys()].filter((id) => !ids.has(id)).forEach(drop);
        for (const t of list) {
          if (perTeam.has(t.id)) continue;
          perTeam.set(t.id, [
            teams.subscribeMembers(t.id, (m) => setSideMembers((s) => ({ ...s, [t.id]: m })), ignore),
            teams.subscribeTeamMarkers(t.id, (m) => setSideMarkers((s) => ({ ...s, [t.id]: m })), ignore),
          ]);
        }
    };
    const unsubTeams =
      scope === 'all'
        ? sides.subscribeSideTeams(sideId, onTeams, ignore)
        : sides.subscribeDirectionTeams(sideId, scope.slice(4), onTeams, ignore);
    return () => {
      unsubTeams();
      [...perTeam.keys()].forEach(drop);
    };
  }, [sideId, uid, scope]);

  // Name of the side my squad belongs to.
  const mySideId = team?.sideId ?? null;
  useEffect(() => {
    if (!mySideId) {
      setMySquadSide(null);
      return;
    }
    // Live: the side may join or leave a game while we play.
    return sides.subscribeSide(mySideId, setMySquadSide, () => {});
  }, [mySideId]);

  const can = useCallback(
    (perm: DeputyPerm) => isSideOwner || Boolean(uid && side?.deputies?.[uid]?.perms.includes(perm)),
    [isSideOwner, uid, side]
  );

  // The side whose roles I draw stars from: the one I serve at, else my squad's.
  const rolesSide = side ?? mySquadSide;
  const starsOf = useCallback(
    (who: string): 0 | 1 | 2 | 3 => {
      if (!rolesSide) return 0;
      if (rolesSide.ownerId === who) return 3;
      if (rolesSide.deputies?.[who]) return 2;
      if (Object.values(rolesSide.directions ?? {}).some((d) => d.cmd === who)) return 1;
      return 0;
    },
    [rolesSide]
  );

  // The side's HQ: who is in it and where they are (shown on everyone's map with stars).
  const rolesSideId = rolesSide?.id ?? null;
  useEffect(() => {
    if (!rolesSideId || !uid) {
      setHq([]);
      return;
    }
    return sides.subscribeHq(rolesSideId, setHq, () => setHq([]));
  }, [rolesSideId, uid]);
  const inHq = Boolean(uid && hq.some((h) => h.uid === uid));

  // HQ people publish their position every 30 s (they may be in no squad at all).
  const { getLastFix } = session;
  useEffect(() => {
    if (!inHq || !rolesSideId || !uid) return;
    const t = setInterval(() => {
      const p = getLastFix();
      if (p) sides.reportHq(rolesSideId, uid, { lat: p.lat, lng: p.lng, heading: p.heading ?? null }).catch(() => {});
    }, 30_000);
    return () => clearInterval(t);
  }, [inHq, rolesSideId, uid, getLastFix]);

  const setDeputy = useCallback(
    async (who: string, d: Deputy | null) => {
      if (!side || !isSideOwner) throw new Error('Назначать заместителей может только командир стороны');
      await sides.setDeputy(side.id, who, d);
    },
    [side, isSideOwner]
  );

  const saveDirections = useCallback(
    async (dirs: Record<string, Direction>) => {
      if (!side || !can('directions')) throw new Error('Направления настраивает командир стороны или его заместитель');
      await sides.saveDirections(side.id, dirs);
    },
    [side, can]
  );

  const hqCode = useCallback(async () => {
    if (!side) throw new Error('Сторона не загружена');
    if (side.hqCode) return side.hqCode;
    if (!isSideOwner) throw new Error('Код штаба ещё не создан: его создаёт командир стороны');
    const code = await sides.ensureHqCode(side);
    // The commander is in the HQ too (so the side sees them on the map).
    if (uid) await sides.joinHq(side.id, uid, callsign || 'КС', code).catch(() => {});
    return code;
  }, [side, isSideOwner, uid, callsign]);

  const leaveHq = useCallback(async () => {
    if (hqSideId && uid) await sides.leaveHq(hqSideId, uid).catch(() => {});
    setHqSideId(null);
    await saveJson(KEYS.hqSide, null);
  }, [hqSideId, uid]);

  const releaseSquad = useCallback(async (id: string) => sides.leaveDirection(id), []);

  const squads = useMemo<Squad[]>(
    () =>
      sideTeams.map((t) => {
        const list = sideMembers[t.id] ?? [];
        return {
          ...t,
          displayColor: colors[t.id] ?? t.color,
          members: list,
          leaderName: list.find((m) => m.id === t.ownerId)?.callsign ?? null,
        };
      }),
    [sideTeams, sideMembers, colors]
  );

  const mapMembers = useMemo<Member[]>(() => {
    const own = teamId
      ? members.map((m) => ({
          ...m,
          // Team game: players come colored by their team.
          color: m.color ?? teamColor,
          leader: m.canCommand || m.id === team?.ownerId,
          teamId,
          stars: starsOf(m.id),
        }))
      : [];
    // The side's HQ people on everyone's map, with their stars (not twice if they are
    // in a squad I already show).
    const shown = new Set(own.map((m) => m.id));
    for (const sq of squads) for (const m of sq.members) shown.add(m.id);
    const hqMarks: Member[] = hq
      .filter((h) => h.uid !== uid && !shown.has(h.uid) && h.lat != null && h.lng != null && starsOf(h.uid) > 0)
      .map((h) => ({
        id: `hq/${h.uid}`,
        callsign: h.callsign,
        role: DEFAULT_ROLE,
        canCommand: true,
        status: 'alive',
        lat: h.lat,
        lng: h.lng,
        heading: h.heading,
        updatedAt: h.updatedAt,
        color: '#F2F2F2',
        leader: true,
        stars: starsOf(h.uid),
        mapLabel: `${h.callsign} · ${STAR_TITLES[starsOf(h.uid)]}`,
      }));
    if (!commandsSquads) return [...own, ...hqMarks];
    const others = squads
      .filter((sq) => sq.id !== teamId)
      .flatMap((sq) => {
        const tagged = sq.members.map((m) => ({
          ...m,
          // Unique across squads; the plain uid stays reserved for my own squad.
          id: `${sq.id}/${m.id}`,
          color: sq.displayColor,
          leader: m.canCommand || m.id === sq.ownerId,
          teamId: sq.id,
          stars: starsOf(m.id),
        }));
        if (showAll) return tagged;
        // One mark per squad: its commander, named after the squad. Without a position
        // of the commander, the freshest of those holding command rights stands in.
        const placed = tagged.filter((m) => m.lat != null && m.lng != null);
        const head =
          placed.find((m) => m.id === `${sq.id}/${sq.ownerId}`) ??
          placed.filter((m) => m.canCommand).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
        return head ? [{ ...head, mapLabel: sq.name }] : [];
      });
    return [...own, ...others, ...hqMarks];
  }, [teamId, members, teamColor, team?.ownerId, commandsSquads, squads, showAll, starsOf, hq, uid]);

  const mapMarkers = useMemo<TacMarker[]>(() => {
    if (!commandsSquads) return markers;
    const seenGroups = new Set(markers.map((m) => m.groupId).filter(Boolean));
    const fromSide: TacMarker[] = [];
    for (const sq of squads) {
      if (sq.id === teamId) continue;
      for (const m of sideMarkers[sq.id] ?? []) {
        if (isVotedOut(m, sq.members.length)) continue;
        // One side order lives in every squad it was sent to; draw it once.
        if (m.groupId) {
          if (seenGroups.has(m.groupId)) continue;
          seenGroups.add(m.groupId);
        }
        fromSide.push({ ...m, id: `${sq.id}/${m.id}` });
      }
    }
    return [...markers, ...fromSide];
  }, [commandsSquads, markers, squads, sideMarkers, teamId]);

  const setShowAll = useCallback(async (v: boolean) => {
    setShowAllState(v);
    await saveJson(KEYS.sideShowAll, v);
  }, []);

  const setSquadColor = useCallback(
    async (id: string, color: string | null) => {
      const next = { ...colors };
      if (color) next[id] = color;
      else delete next[id];
      setColors(next);
      await saveJson(KEYS.sideColors, next);
    },
    [colors]
  );

  const requireUid = useCallback(() => {
    if (!uid) throw new Error('Нет подключения к серверу');
    return uid;
  }, [uid]);

  const createSide = useCallback(
    async (name: string) => {
      const id = await withTimeout(sides.createSide(requireUid(), name.trim() || 'Сторона'));
      setSideId(id);
      await saveJson(KEYS.sideId, id);
    },
    [requireUid]
  );

  const adoptSide = useCallback(async (id: string) => {
    setSideId(id);
    await saveJson(KEYS.sideId, id);
  }, []);

  const resign = useCallback(async () => {
    setSideId(null);
    await saveJson(KEYS.sideId, null);
  }, []);

  const dropSquad = useCallback(
    async (id: string) => {
      if (!can('squads')) throw new Error('Отключать отряды может командир стороны или заместитель с этим правом');
      await sides.detachTeam(id);
    },
    [can]
  );

  const attachMySquad = useCallback(
    async (code: string) => {
      if (!teamId || !isOwner) throw new Error('Привязать отряд к стороне может только создатель отряда');
      await sides.attachTeam(teamId, code);
    },
    [teamId, isOwner]
  );

  const detachMySquad = useCallback(async () => {
    if (teamId && isOwner) await sides.detachTeam(teamId);
  }, [teamId, isOwner]);

  const placeOrder = useCallback(
    async (o: { kind: OrderKind; label: string; lat: number; lng: number }, target: OrderTarget) => {
      if (target === 'own') return session.addMarker(o, 'team');
      if (isSideCommander && !can('orders')) throw new Error('Приказы отрядам: у вас нет этого права, его даёт командир стороны');
      const ids = target === 'all' ? squads.map((s) => s.id) : [target];
      if (!ids.length) throw new Error(isDirCommander ? 'В направлении ещё нет отрядов' : 'К стороне ещё не присоединён ни один отряд');
      await sides.placeSideOrder(ids, {
        ...o,
        label: o.label.trim().slice(0, 40),
        createdBy: requireUid(),
        createdByName: callsign || (isDirCommander ? 'Командир направления' : 'Командир стороны'),
      });
    },
    [session, squads, requireUid, callsign, isSideCommander, isDirCommander, can]
  );

  const deleteMarker = useCallback(
    async (m: TacMarker) => {
      if (m.groupId && commandsSquads) {
        // Every copy of the order: my own squad's (no teamId there) and the other squads'.
        const copies = [
          ...(teamId ? markers.filter((x) => x.groupId === m.groupId && !x.personal).map((x) => ({ teamId, id: x.id })) : []),
          ...Object.entries(sideMarkers).flatMap(([sq, list]) =>
            sq === teamId ? [] : list.filter((x) => x.groupId === m.groupId).map((x) => ({ teamId: sq, id: x.id }))
          ),
        ];
        return sides.deleteSideOrder(copies);
      }
      if (m.teamId && m.teamId !== teamId) {
        // A squad's marker seen through the side view.
        return teams.deleteTeamMarker(m.teamId, m.id.split('/').pop()!);
      }
      return session.deleteMarker(m);
    },
    [commandsSquads, markers, sideMarkers, teamId, session]
  );

  const rankContext = useCallback(
    (teamOf: string | undefined): RankContext => {
      const sq = teamOf && teamOf !== teamId ? squads.find((x) => x.id === teamOf) : undefined;
      if (sq) {
        return {
          ownerId: sq.ownerId,
          sideOwnerId: side?.ownerId,
          sideStaff: new Set(Object.keys(side?.deputies ?? {})),
          dirCmd: sq.dirId ? (side?.directions?.[sq.dirId]?.cmd ?? null) : null,
          commanders: new Set(sq.members.filter((m) => m.canCommand).map((m) => m.id)),
        };
      }
      return {
        ownerId: team?.ownerId,
        sideOwnerId: mySquadSide?.ownerId,
        sideStaff: new Set(Object.keys(mySquadSide?.deputies ?? {})),
        dirCmd: team?.dirId ? (mySquadSide?.directions?.[team.dirId]?.cmd ?? null) : null,
        commanders: new Set(members.filter((m) => m.canCommand).map((m) => m.id)),
      };
    },
    [teamId, squads, side, team?.ownerId, team?.dirId, mySquadSide, members]
  );

  const canDelete = useCallback(
    (m: TacMarker) => {
      // Side orders always come from the side commander, even if the side itself
      // hasn't loaded here yet; only they may cancel them.
      if (m.groupId && m.audience === 'commanders' && m.createdBy !== uid && !commandsSquads) return false;
      return canDeleteMarker(uid, m, rankContext(m.teamId));
    },
    [uid, rankContext, commandsSquads]
  );

  const myRank = rankOf(uid, rankContext(teamId ?? undefined));

  const acceptInvite = useCallback(
    async (invite: Invite) => {
      if (invite.kind === 'team') {
        await session.joinTeam(invite.code);
        return 'Вы вступили в отряд';
      }
      if (invite.kind === 'hq') {
        await sides.joinHq(invite.sideId, requireUid(), callsign || 'Штаб', invite.code);
        setHqSideId(invite.sideId);
        await saveJson(KEYS.hqSide, invite.sideId);
        return 'Вы в штабе стороны. Роль даст командир стороны или его заместитель.';
      }
      if (invite.kind === 'dir') {
        if (!teamId || !isOwner) throw new Error('Отряд в направление вводит его командир (создатель отряда)');
        await sides.joinDirection(teamId, invite.sideId, invite.dirId, invite.code);
        return 'Отряд вошёл в направление';
      }
      await attachMySquad(invite.code);
      return 'Отряд присоединён к стороне';
    },
    [session, attachMySquad, requireUid, callsign, teamId, isOwner]
  );

  const value = useMemo<SideState>(
    () => ({
      side,
      isSideCommander,
      isDeputy,
      isSideOwner,
      can,
      isDirCommander,
      myDirection,
      commandsSquads,
      starsOf,
      hq,
      inHq,
      setDeputy,
      saveDirections,
      hqCode,
      leaveHq,
      releaseSquad,
      squads,
      showAll,
      setShowAll,
      setSquadColor,
      createSide,
      resign,
      adoptSide,
      dropSquad,
      mySquadSide,
      attachMySquad,
      detachMySquad,
      mapMembers,
      mapMarkers,
      placeOrder,
      deleteMarker,
      canDelete,
      myRank,
      acceptInvite,
    }),
    [
      side,
      isSideCommander,
      isDeputy,
      isSideOwner,
      can,
      isDirCommander,
      myDirection,
      commandsSquads,
      starsOf,
      hq,
      inHq,
      setDeputy,
      saveDirections,
      hqCode,
      leaveHq,
      releaseSquad,
      squads,
      showAll,
      setShowAll,
      setSquadColor,
      createSide,
      resign,
      adoptSide,
      dropSquad,
      mySquadSide,
      attachMySquad,
      detachMySquad,
      mapMembers,
      mapMarkers,
      placeOrder,
      deleteMarker,
      canDelete,
      myRank,
      acceptInvite,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
