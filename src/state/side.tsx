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
import { KEYS, loadJson, saveJson } from '../lib/storage';
import type { Member, OrderKind, Side, TacMarker, Team } from '../lib/types';
import * as sides from '../services/sides';
import * as teams from '../services/teams';
import { useSession } from './session';

export type Squad = Team & {
  /** Color the side commander sees it in (local override or the squad's own). */
  displayColor: string;
  members: Member[];
  leaderName: string | null;
};

/** 'own' = my squad's fighters (squad order); 'all' or a team id = side order to squad commanders. */
export type OrderTarget = 'own' | 'all' | string;

type SideState = {
  /** The side I command, if any. */
  side: Side | null;
  isSideCommander: boolean;
  squads: Squad[];
  /** Side map filter: every fighter, or squad commanders only. */
  showAll: boolean;
  setShowAll: (v: boolean) => Promise<void>;
  setSquadColor: (teamId: string, color: string | null) => Promise<void>;
  createSide: (name: string) => Promise<void>;
  resign: () => Promise<void>;
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

  const [sideId, setSideId] = useState<string | null>(null);
  const [side, setSide] = useState<Side | null>(null);
  const [sideTeams, setSideTeams] = useState<Team[]>([]);
  const [sideMembers, setSideMembers] = useState<Record<string, Member[]>>({});
  const [sideMarkers, setSideMarkers] = useState<Record<string, TacMarker[]>>({});
  const [colors, setColors] = useState<Record<string, string>>({});
  const [showAll, setShowAllState] = useState(true);
  const [mySquadSide, setMySquadSide] = useState<Side | null>(null);

  useEffect(() => {
    (async () => {
      setSideId(await loadJson<string | null>(KEYS.sideId, null));
      setColors(await loadJson<Record<string, string>>(KEYS.sideColors, {}));
      setShowAllState(await loadJson<boolean>(KEYS.sideShowAll, true));
    })();
  }, []);

  // Side commander: the side doc, attached squads, and each squad's roster and markers.
  useEffect(() => {
    if (!sideId || !uid) {
      setSide(null);
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
    const unsubSide = sides.subscribeSide(sideId, setSide, ignore);
    const unsubTeams = sides.subscribeSideTeams(
      sideId,
      (list) => {
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
      },
      ignore
    );
    return () => {
      unsubSide();
      unsubTeams();
      [...perTeam.keys()].forEach(drop);
    };
  }, [sideId, uid]);

  // Name of the side my squad belongs to.
  const mySideId = team?.sideId ?? null;
  useEffect(() => {
    if (!mySideId) {
      setMySquadSide(null);
      return;
    }
    let live = true;
    sides
      .getSide(mySideId)
      .then((s) => live && setMySquadSide(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [mySideId]);

  const isSideCommander = Boolean(side && uid && side.ownerId === uid);

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
          color: teamColor,
          leader: m.canCommand || m.id === team?.ownerId,
          teamId,
        }))
      : [];
    if (!isSideCommander) return own;
    const others = squads
      .filter((sq) => sq.id !== teamId)
      .flatMap((sq) =>
        sq.members.map((m) => ({
          ...m,
          // Unique across squads; the plain uid stays reserved for my own squad.
          id: `${sq.id}/${m.id}`,
          color: sq.displayColor,
          leader: m.canCommand || m.id === sq.ownerId,
          teamId: sq.id,
        }))
      )
      .filter((m) => showAll || m.leader);
    return [...own, ...others];
  }, [teamId, members, teamColor, team?.ownerId, isSideCommander, squads, showAll]);

  const mapMarkers = useMemo<TacMarker[]>(() => {
    if (!isSideCommander) return markers;
    const seenGroups = new Set(markers.map((m) => m.groupId).filter(Boolean));
    const fromSide: TacMarker[] = [];
    for (const sq of squads) {
      if (sq.id === teamId) continue;
      for (const m of sideMarkers[sq.id] ?? []) {
        // One side order lives in every squad it was sent to; draw it once.
        if (m.groupId) {
          if (seenGroups.has(m.groupId)) continue;
          seenGroups.add(m.groupId);
        }
        fromSide.push({ ...m, id: `${sq.id}/${m.id}` });
      }
    }
    return [...markers, ...fromSide];
  }, [isSideCommander, markers, squads, sideMarkers, teamId]);

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
      const id = await sides.createSide(requireUid(), name.trim() || 'Сторона');
      setSideId(id);
      await saveJson(KEYS.sideId, id);
    },
    [requireUid]
  );

  const resign = useCallback(async () => {
    setSideId(null);
    await saveJson(KEYS.sideId, null);
  }, []);

  const dropSquad = useCallback(async (id: string) => sides.detachTeam(id), []);

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
      const ids = target === 'all' ? squads.map((s) => s.id) : [target];
      if (!ids.length) throw new Error('К стороне ещё не присоединён ни один отряд');
      await sides.placeSideOrder(ids, {
        ...o,
        label: o.label.trim().slice(0, 40),
        createdBy: requireUid(),
        createdByName: callsign || 'Командир стороны',
      });
    },
    [session, squads, requireUid, callsign]
  );

  const deleteMarker = useCallback(
    async (m: TacMarker) => {
      if (m.groupId && isSideCommander) {
        const all = [...markers, ...Object.values(sideMarkers).flat()];
        const copies = all
          .filter((x) => x.groupId === m.groupId && x.teamId)
          .map((x) => ({ teamId: x.teamId!, id: x.id.split('/').pop()! }));
        return sides.deleteSideOrder(copies);
      }
      if (m.teamId && m.teamId !== teamId) {
        // A squad's marker seen through the side view.
        return teams.deleteTeamMarker(m.teamId, m.id.split('/').pop()!);
      }
      return session.deleteMarker(m);
    },
    [isSideCommander, markers, sideMarkers, teamId, session]
  );

  const acceptInvite = useCallback(
    async (invite: Invite) => {
      if (invite.kind === 'team') {
        await session.joinTeam(invite.code);
        return 'Вы вступили в отряд';
      }
      await attachMySquad(invite.code);
      return 'Отряд присоединён к стороне';
    },
    [session, attachMySquad]
  );

  const value = useMemo<SideState>(
    () => ({
      side,
      isSideCommander,
      squads,
      showAll,
      setShowAll,
      setSquadColor,
      createSide,
      resign,
      dropSquad,
      mySquadSide,
      attachMySquad,
      detachMySquad,
      mapMembers,
      mapMarkers,
      placeOrder,
      deleteMarker,
      acceptInvite,
    }),
    [
      side,
      isSideCommander,
      squads,
      showAll,
      setShowAll,
      setSquadColor,
      createSide,
      resign,
      dropSquad,
      mySquadSide,
      attachMySquad,
      detachMySquad,
      mapMembers,
      mapMarkers,
      placeOrder,
      deleteMarker,
      acceptInvite,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
