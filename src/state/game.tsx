import type { Unsubscribe } from 'firebase/firestore';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Vibration } from 'react-native';

import { pointsAt, scoreMinute } from '../lib/game';
import {
  ballCounts,
  ballPush,
  checkpointsPassed,
  convoyResult,
  heldMinutes,
  holdings,
  matchState,
  pathLength,
  pointAlong,
  rollBall,
  flagLeader,
  flagStep,
  type FlagCap,
  sectorAt,
  SIDE_COLORS,
  territoryMinute,
  territoryResult,
  territorySectors,
  ticketsLeft,
  zonePoints,
} from '../lib/gameModes';
import { hotState, type HotZone } from '../lib/hotzone';
import type { Invite } from '../lib/invite';
import { DEFAULT_ROLE } from '../lib/roles';
import { KEYS, loadJson, saveJson } from '../lib/storage';
import type { Game, GamePlayer, GameSide, GameTech, LatLng, Member, SelfPosition, Side, TacMarker, Team } from '../lib/types';
import * as games from '../services/games';
import * as sides from '../services/sides';
import * as teams from '../services/teams';

import { useSession } from './session';
import { useSide } from './side';
import { withTimeout } from '../lib/firebase';

/** A tech counts as online (and may referee) if their position is this fresh. */
const TECH_ONLINE_MS = 3 * 60_000;
/** Territory reports for a minute are counted this long after it ends. */
const REFEREE_GRACE_MS = 8_000;
/** Players report their territory this far into each match minute. */
const REPORT_AT_MS = 30_000;
/** Football: how often the referee rolls the balls. */
const BALL_TICK_MS = 3000;
/** The referee writes a moving convoy at least this often (5 ticks may be rolled at once). */
const BALL_WRITE_MS = 12_000;
/** Fighters' positions older than this don't push a ball. */
// Standing fighters write their position once a minute: keep them counted between.
const BALL_FRESH_MS = 90_000;

export type GameScores = {
  /** Lives left per side (tickets mode). */
  tickets: Record<string, number> | null;
  /** Control zone points per side, for the newest zone. */
  zone: Record<string, number>;
  zoneId: string | null;
  /** Flags held now and minutes held per side. */
  flags: Record<string, number>;
  flagMinutes: Record<string, number>;
  /** Territories held now, minutes held, and the winners when the match is over. */
  sectors: Record<string, number>;
  sectorMinutes: Record<string, number>;
  /** Football: share of its arrow each side's ball has rolled (0..1), and who scored. */
  balls: Record<string, number>;
  /** Convoy checkpoints passed per side, out of `checkpointsTotal` (the base included). */
  checkpoints: Record<string, number>;
  checkpointsTotal: Record<string, number>;
  /** The side whose convoy reached the enemy base first. */
  goal: string | null;
  winners: string[];
};

export type RosterSquad = { id: string; name: string; color: string; members: Member[] };
export type RosterSide = { id: string; name: string; color: string; squads: RosterSquad[] };

type GameState = {
  gameId: string | null;
  game: Game | null;
  /** I'm one of the game's techs (organizers, all with the same rights). */
  isTech: boolean;
  isCreator: boolean;
  techs: GameTech[];
  /** The game's sides (name, color, ticket adjustments). */
  sides: GameSide[];
  /** Techs: side docs with commanders and claim codes. */
  sideDocs: Side[];
  players: GamePlayer[];
  /** Game markers (control zones, flags, sectors), drawn for everyone in the game. */
  markers: TacMarker[];
  /** My side in the game (players). */
  mySideId: string | null;
  sideColor: (sideId: string | null | undefined) => string;
  sideName: (sideId: string | null | undefined) => string;
  scores: GameScores;
  /** Techs: every side's squads and fighters, for the HQ panel. */
  roster: RosterSide[];
  /** Extra people on the map: game techs for everyone; for techs, the fighters of every side. */
  mapMembers: Member[];
  showAll: boolean;
  setShowAll: (v: boolean) => Promise<void>;

  createGame: (name: string) => Promise<void>;
  joinAsTech: (code: string) => Promise<void>;
  leave: () => Promise<void>;
  removeTech: (uid: string) => Promise<void>;
  attachSide: (code: string) => Promise<void>;
  detachSide: (sideId: string) => Promise<void>;
  createSide: (name: string) => Promise<Side>;
  saveSide: (s: GameSide) => Promise<void>;
  startMatch: (minutes: number) => Promise<void>;
  stopMatch: () => Promise<void>;
  setTickets: (n: number | null) => Promise<void>;
  setTiebreak: (t: 'draw' | 'time') => Promise<void>;
  addZone: (at: LatLng, zone: HotZone, label: string) => Promise<void>;
  setZone: (m: TacMarker, zone: HotZone) => Promise<void>;
  addFlag: (at: LatLng, label: string) => Promise<void>;
  addTerritory: (center: LatLng, size: number) => Promise<void>;
  resetTerritory: () => Promise<void>;
  /** Football: a side's ball at the start of its arrow (start → the other side's base). */
  addBall: (sideId: string, points: LatLng[]) => Promise<void>;
  deleteMarker: (m: TacMarker) => Promise<void>;
  /** A fighter captures a flag for their side (standing next to it). */
  captureFlag: (m: TacMarker) => Promise<void>;
  /** Game screen → map: place this mode's objects at the crosshair (convoy: draw its route). */
  placeRequest: GamePlace | null;
  requestPlace: (k: GamePlace | null) => void;
  /** Removes every object of one mode from the map. */
  removeMode: (k: GamePlace) => Promise<void>;
  /** Techs: publish my position (shown to everyone as an orange diamond). */
  reportPosition: (p: SelfPosition) => void;
  /** Any scanned or opened invite: game ones here, squad and side ones via the side. */
  acceptInvite: (invite: Invite) => Promise<string>;
};

export type GamePlace = 'sector' | 'flag' | 'hotzone' | 'ball';

const Ctx = createContext<GameState | null>(null);

/**
 * A listener that comes back after an error. Firestore drops a listener for good on
 * a refusal, and a tech's listeners are refused when they start a moment before the
 * side they read is written (a new side, a squad just attached): without this the
 * tech's phone never saw the fighters, so flags, territories and convoys never moved.
 */
function retrying(subscribe: (onError: (e: Error) => void) => Unsubscribe, delayMs = 4000): Unsubscribe {
  let stopped = false;
  let current: Unsubscribe | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // 4 s, 8 s, 16 s… up to 2 min: a refusal that lasts (removed from the game) must not
  // re-read every few seconds and eat the database's daily read limit.
  let wait = delayMs;
  const start = () => {
    if (stopped) return;
    current = subscribe(() => {
      current?.();
      current = null;
      if (!stopped) timer = setTimeout(start, wait);
      wait = Math.min(wait * 2, 120_000);
    });
  };
  start();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    current?.();
  };
}

export function useGame(): GameState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useGame must be used inside <GameProvider>');
  return v;
}

export function GameProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const side = useSide();
  const { uid, callsign, teamId, status, getLastFix } = session;

  const [techGameId, setTechGameId] = useState<string | null>(null);
  const [showAll, setShowAllState] = useState(false);
  useEffect(() => {
    loadJson<string | null>(KEYS.techGame, null).then(setTechGameId);
    loadJson<boolean>(KEYS.techShowAll, false).then(setShowAllState);
  }, []);

  // Which game, and as whom: a tech, or a player through their squad's (or own) side.
  const squadSide = side.mySquadSide;
  const commandedSide = side.isSideCommander ? side.side : null;
  const playerSide = squadSide?.gameId ? squadSide : commandedSide?.gameId ? commandedSide : null;
  const gameId = techGameId ?? playerSide?.gameId ?? null;

  const [game, setGame] = useState<Game | null>(null);
  const [techs, setTechs] = useState<GameTech[]>([]);
  const [gameSides, setGameSides] = useState<GameSide[]>([]);
  const [players, setPlayers] = useState<GamePlayer[]>([]);
  const [markers, setMarkers] = useState<TacMarker[]>([]);
  const [placeRequest, requestPlace] = useState<GamePlace | null>(null);
  useEffect(() => {
    setGame(null);
    setTechs([]);
    setGameSides([]);
    setPlayers([]);
    setMarkers([]);
    if (!gameId || !uid) return;
    // Retried: right after creating or joining a game the first reads can be refused.
    const subs = [
      retrying((e) => games.subscribeGame(gameId, setGame, e)),
      retrying((e) => games.subscribeTechs(gameId, setTechs, e)),
      retrying((e) => games.subscribeGameSides(gameId, setGameSides, e)),
      retrying((e) => games.subscribePlayers(gameId, setPlayers, e)),
      retrying((e) => games.subscribeGameMarkers(gameId, setMarkers, e)),
    ];
    return () => subs.forEach((u) => u());
  }, [gameId, uid]);

  const isTech = Boolean(uid && techGameId && techs.some((t) => t.uid === uid));
  const isCreator = Boolean(uid && game && game.ownerId === uid);
  // Removed from the techs by the creator: forget the game here too.
  const techsLoaded = techs.length > 0;
  useEffect(() => {
    if (techGameId && techsLoaded && uid && !techs.some((t) => t.uid === uid)) {
      setTechGameId(null);
      saveJson(KEYS.techGame, null).catch(() => {});
    }
  }, [techGameId, techsLoaded, techs, uid]);

  // Techs see every side: side docs, their squads and the squads' fighters.
  const [sideDocs, setSideDocs] = useState<Side[]>([]);
  const [squads, setSquads] = useState<Record<string, Team[]>>({});
  const [squadMembers, setSquadMembers] = useState<Record<string, Member[]>>({});
  useEffect(() => {
    setSideDocs([]);
    setSquads({});
    setSquadMembers({});
    if (!isTech || !gameId) return;
    const perSide = new Map<string, Unsubscribe>();
    const perTeam = new Map<string, Unsubscribe>();
    const unsub = retrying((onSidesError) =>
      games.subscribeSidesOfGame(
      gameId,
      (list) => {
        setSideDocs(list);
        const ids = new Set(list.map((s) => s.id));
        for (const [id, u] of perSide) {
          if (ids.has(id)) continue;
          u();
          perSide.delete(id);
          setSquads(({ [id]: _, ...rest }) => rest);
        }
        for (const s of list) {
          if (perSide.has(s.id)) continue;
          perSide.set(
            s.id,
            retrying((onError) =>
              sides.subscribeSideTeams(
              s.id,
              (ts) => {
                setSquads((cur) => ({ ...cur, [s.id]: ts }));
                for (const t of ts) {
                  if (perTeam.has(t.id)) continue;
                  perTeam.set(
                    t.id,
                    retrying((onError) =>
                      teams.subscribeMembers(t.id, (m) => setSquadMembers((cur) => ({ ...cur, [t.id]: m })), onError)
                    )
                  );
                }
              },
              onError
              )
            )
          );
        }
      },
      onSidesError
      )
    );
    return () => {
      unsub();
      perSide.forEach((u) => u());
      perTeam.forEach((u) => u());
    };
  }, [isTech, gameId]);

  const mySideId = isTech ? null : (playerSide?.id ?? null);
  const sideColor = useCallback(
    (id: string | null | undefined) => gameSides.find((s) => s.id === id)?.color ?? '#C3CCC6',
    [gameSides]
  );
  const sideName = useCallback(
    (id: string | null | undefined) => gameSides.find((s) => s.id === id)?.name ?? 'никто',
    [gameSides]
  );

  // Players register under the game (the rules check squad → side → game).
  const registered = useRef<string | null>(null);
  const regTeam = squadSide?.gameId ? teamId : null;
  useEffect(() => {
    if (!gameId || !uid || isTech || !mySideId) return;
    const key = `${gameId}/${mySideId}/${regTeam}`;
    if (registered.current === key) return;
    registered.current = key;
    games
      .registerPlayer(gameId, uid, { sideId: mySideId, teamId: regTeam, callsign: callsign || 'Боец' })
      .catch(() => {
        registered.current = null;
      });
  }, [gameId, uid, isTech, mySideId, regTeam, callsign]);
  const me = players.find((p) => p.uid === uid);
  // A boolean, not the doc: the players list changes every minute, and timers that
  // depend on it would restart before they ever fire.
  const inGame = Boolean(me);

  // Tickets: every «Я убит» costs the side a life.
  const prevStatus = useRef(status);
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    if (status === 'dead' && was !== 'dead' && gameId && uid && inGame && game?.tickets != null) {
      games.addDeath(gameId, uid).catch(() => {});
    }
  }, [status, gameId, uid, inGame, game?.tickets]);

  // Control zone (WARDOGS): the newest game zone; each fighter scores for their side.
  const zone = useMemo(
    () =>
      markers.filter((m) => m.zone).reduce<TacMarker | null>((a, m) => (!a || m.createdAt > a.createdAt ? m : a), null),
    [markers]
  );
  // Every game-marker snapshot (balls move every few seconds) makes new objects: timers
  // key on what matters and read the latest zone through a ref.
  const zoneRef = useRef(zone);
  zoneRef.current = zone;
  const zoneKey = zone?.zone ? `${zone.id}:${JSON.stringify(zone.zone)}` : null;
  const scoredMinutes = useRef<Record<string, number> | null>(null);
  useEffect(() => {
    loadJson<Record<string, number>>(KEYS.zoneTicks, {}).then((v) => {
      scoredMinutes.current = { ...v, ...(scoredMinutes.current ?? {}) };
    });
  }, []);
  useEffect(() => {
    if (!zoneKey || !gameId || !uid || !inGame || status === 'dead') return;
    const t = setInterval(() => {
      const seen = scoredMinutes.current;
      const zone = zoneRef.current;
      const z = zone?.zone;
      if (!seen || !zone || !z) return;
      const now = Date.now();
      const minute = scoreMinute(z, now);
      const last = seen[zone.id];
      if (last != null && minute <= last) return;
      seen[zone.id] = minute;
      saveJson(KEYS.zoneTicks, seen).catch(() => {});
      if (last == null || minute < 1) return;
      const pos = getLastFix();
      if (!pos || now - pos.timestamp > 10 * 60_000) return;
      const n = pointsAt(pos, zone, z, hotState(zone, z, now));
      if (n > 0) games.addZonePoints(gameId, uid, zone.id, n).catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [zoneKey, gameId, uid, inGame, status, getLastFix]);

  // Hot zone buzz: the next spot appears, the slide starts.
  const zonePhase = useRef<string | null>(null);
  useEffect(() => {
    if (!zoneKey) return;
    const t = setInterval(() => {
      const zone = zoneRef.current;
      if (!zone?.zone) return;
      const st = hotState(zone, zone.zone, Date.now());
      const key = `${st.k}:${st.phase}`;
      const prev = zonePhase.current;
      zonePhase.current = key;
      if (prev == null || prev === key) return;
      if (st.phase === 'warn') Vibration.vibrate([0, 400, 200, 400]);
      else if (st.phase === 'move') Vibration.vibrate([0, 200, 120, 200, 120, 200]);
    }, 1000);
    return () => clearInterval(t);
  }, [zoneKey]);

  // Territories: every match minute a living fighter reports the sector they're in.
  const sectors = useMemo(() => markers.filter((m) => m.kind === 'sector' && m.points), [markers]);
  const balls = useMemo(
    () => markers.filter((m) => m.kind === 'ball' && m.owner && m.points && m.points.length >= 2),
    [markers]
  );
  const reported = useRef(-1);
  const sectorsRef = useRef(sectors);
  sectorsRef.current = sectors;
  const hasSectors = sectors.length > 0;
  useEffect(() => {
    if (!game?.match || !hasSectors || !gameId || !uid || !inGame) return;
    const match = game.match;
    const t = setInterval(() => {
      const now = Date.now();
      const st = matchState(match, now);
      if (st.phase !== 'running' || st.minute <= reported.current) return;
      // Mid-minute: the fix then is what counts for this minute. Well clear of the
      // referee's pass just after the minute, so phones whose clocks are some seconds
      // off still land in the right minute.
      if ((now - match.start) % 60_000 < REPORT_AT_MS) return;
      reported.current = st.minute;
      const pos = getLastFix();
      const fresh = pos && now - pos.timestamp < 2 * 60_000 && status !== 'dead';
      const cell = fresh ? (sectorAt(pos, sectorsRef.current)?.id ?? null) : null;
      games.reportCell(gameId, uid, cell, st.minute).catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [game?.match, hasSectors, gameId, uid, inGame, status, getLastFix]);

  // Referee: one online tech (the first by uid) counts each finished minute.
  const playersRef = useRef(players);
  playersRef.current = players;
  const refereed = useRef(-1);
  const now0 = Date.now();
  const referee = useMemo(
    () =>
      techs
        .filter((t) => t.uid === uid || (t.updatedAt != null && now0 - t.updatedAt < TECH_ONLINE_MS))
        .map((t) => t.uid)
        .sort()[0] ?? null,
    // Re-picked whenever the techs list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [techs, uid]
  );
  useEffect(() => {
    if (!isTech || referee !== uid || !game?.match || !gameId) return;
    const match = game.match;
    const t = setInterval(() => {
      const now = Date.now();
      const end = Math.min(match.start + match.minutes * 60_000, match.stoppedAt ?? Infinity);
      // Last finished minute whose reports have had time to arrive.
      const upTo = Math.floor((Math.min(now, end + REFEREE_GRACE_MS) - REFEREE_GRACE_MS - match.start) / 60_000) - 1;
      const lastMinute = Math.floor((end - match.start) / 60_000) - 1;
      const target = Math.min(upTo, lastMinute);
      if (target < 0 || target <= refereed.current) return;
      // Players' docs hold only their latest minute, so older minutes can't be
      // recounted: a referee that starts (or takes over) late counts the last one only.
      const k = target;
      // A sector already counted for this minute (by another tech's phone) is skipped:
      // counting it twice would double the capture.
      const todo = sectorsRef.current.filter((s) => (s.min ?? -1) < k);
      const updates = territoryMinute(
        playersRef.current,
        todo.map((s) => ({ id: s.id, owner: s.owner, cap: s.cap ?? null })),
        k
      );
      const at = match.start + (k + 1) * 60_000;
      for (const u of updates) {
        const s = sectorsRef.current.find((x) => x.id === u.id);
        if (!s) continue;
        const patch: Record<string, unknown> = { cap: u.cap, min: k };
        if (u.owner) {
          patch.owner = u.owner;
          patch.log = [...(s.log ?? []), { s: u.owner, t: at }];
        }
        games.updateGameMarker(gameId, s.id, patch as Partial<TacMarker>).catch(() => {});
      }
      refereed.current = k;
    }, 5000);
    return () => clearInterval(t);
  }, [isTech, referee, uid, game?.match, gameId]);
  // Football referee: rolls each ball by who's around it, every few seconds.
  const fighters = useMemo(() => {
    const out: { sideId: string; lat: number; lng: number; updatedAt?: number | null }[] = [];
    if (!isTech) return out;
    for (const sd of sideDocs) {
      for (const t of squads[sd.id] ?? []) {
        for (const m of squadMembers[t.id] ?? []) {
          if (m.lat == null || m.lng == null || m.status === 'dead') continue;
          out.push({ sideId: sd.id, lat: m.lat, lng: m.lng, updatedAt: m.updatedAt });
        }
      }
    }
    return out;
  }, [isTech, sideDocs, squads, squadMembers]);
  const fightersRef = useRef(fighters);
  fightersRef.current = fighters;
  const ballsRef = useRef(balls);
  ballsRef.current = balls;
  const hasBalls = balls.length > 0;
  const ballWrites = useRef(new Map<string, number>());
  const flagMarkers = useMemo(() => markers.filter((m) => m.kind === 'flag'), [markers]);
  const flagsRef = useRef(flagMarkers);
  flagsRef.current = flagMarkers;
  const hasFlags = flagMarkers.length > 0;
  useEffect(() => {
    if (!isTech || referee !== uid || !game?.match || !gameId || !(hasBalls || hasFlags)) return;
    const match = game.match;
    const t = setInterval(() => {
      const now = Date.now();
      if (matchState(match, now).phase !== 'running') return;
      const live = fightersRef.current.filter((f) => f.updatedAt != null && now - f.updatedAt < BALL_FRESH_MS);
      // Flags: whoever outnumbers the others at a flag for 30 s takes it. Written only
      // when something changes, not every tick.
      for (const f of flagsRef.current) {
        const cap = (f.fcap as FlagCap | undefined) ?? null;
        const next = flagStep(f.owner ?? null, cap, flagLeader(f, live), now);
        if (next.captured) {
          games
            .updateGameMarker(gameId, f.id, { owner: next.owner, log: [...(f.log ?? []), { s: next.owner!, t: now }], fcap: null } as Partial<TacMarker>)
            .catch(() => {});
        } else if ((next.cap?.s ?? null) !== (cap?.s ?? null)) {
          games.updateGameMarker(gameId, f.id, { fcap: next.cap } as Partial<TacMarker>).catch(() => {});
        }
      }
      for (const b of ballsRef.current) {
        const pts = b.points as LatLng[];
        const cur = b.ball ?? { progress: 0, at: match.start, push: 0, goal: null };
        if (cur.goal) continue;
        const pos = pointAlong(pts, cur.progress);
        const c = ballCounts(pos, b.owner as string, live);
        const push = ballPush(c.owners, c.opponents);
        if (push === 0 && cur.push === 0) continue;
        // A new referee or a pause in updates: never roll more than a few ticks at once.
        const from = { ...cur, at: Math.max(cur.at, match.start, now - 5 * BALL_TICK_MS) };
        const next = rollBall(from, pathLength(pts), now, push);
        // Every write is read by every phone in the game: write when the speed changes,
        // at a checkpoint or the base, and otherwise every 12 s (phones extrapolate between).
        const last = ballWrites.current.get(b.id) ?? 0;
        const changed =
          push !== cur.push ||
          Boolean(next.goal) ||
          checkpointsPassed(pts, next.progress) !== checkpointsPassed(pts, cur.progress);
        if (!changed && now - last < BALL_WRITE_MS) continue;
        ballWrites.current.set(b.id, now);
        games.updateGameMarker(gameId, b.id, { ball: next }).catch(() => {});
        if (next.goal) games.setMatch(gameId, { ...match, stoppedAt: now }).catch(() => {});
      }
    }, BALL_TICK_MS);
    return () => clearInterval(t);
  }, [isTech, referee, uid, game?.match, gameId, hasBalls, hasFlags]);

  // A new match starts the count over.
  const matchStart = game?.match?.start;
  useEffect(() => {
    refereed.current = -1;
    reported.current = -1;
  }, [matchStart]);

  // Scores.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const scores = useMemo<GameScores>(() => {
    const now = Date.now();
    const ms = matchState(game?.match, now);
    const until = ms.phase === 'over' ? ms.endedAt : now;
    const flags = markers.filter((m) => m.kind === 'flag');
    const flagMinutes: Record<string, number> = {};
    for (const f of flags) {
      for (const [k, v] of Object.entries(heldMinutes(f.log, until))) flagMinutes[k] = (flagMinutes[k] ?? 0) + v;
    }
    const terr = territoryResult(sectors, until, game?.tiebreak ?? 'draw');
    const ballList = balls.map((b) => ({
      owner: b.owner as string,
      progress: b.ball?.progress ?? 0,
      length: pathLength(b.points ?? []),
      checkpoints: checkpointsPassed(b.points ?? [], b.ball?.progress ?? 0),
      total: Math.max(0, (b.points?.length ?? 1) - 1),
      goal: b.ball?.goal ?? null,
    }));
    const ballShare: Record<string, number> = {};
    const checkpoints: Record<string, number> = {};
    const checkpointsTotal: Record<string, number> = {};
    for (const b of ballList) {
      ballShare[b.owner] = b.length > 0 ? b.progress / b.length : 0;
      checkpoints[b.owner] = b.checkpoints;
      checkpointsTotal[b.owner] = b.total;
    }
    const convoy = convoyResult(ballList, gameSides.map((s) => s.id));
    const goal = ballList.some((b) => b.goal) ? convoy[0] : null;
    return {
      tickets: game?.tickets != null ? ticketsLeft(game.tickets, gameSides, players) : null,
      zone: zone ? zonePoints(players, zone.id) : {},
      zoneId: zone?.id ?? null,
      flags: holdings(flags),
      flagMinutes,
      sectors: terr.count,
      sectorMinutes: terr.minutes,
      balls: ballShare,
      checkpoints,
      checkpointsTotal,
      goal,
      winners: goal
        ? [goal]
        : ms.phase !== 'over'
          ? []
          : ballList.length
            ? convoy
            : sectors.length
              ? terr.winners
              : [],
    };
    // `tick` refreshes held minutes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, gameSides, players, markers, sectors, balls, zone, tick]);

  // Convoy: the escort's phones buzz at each checkpoint, longer at the enemy base.
  const myCheckpoints = mySideId ? (scores.checkpoints[mySideId] ?? null) : null;
  const lastCheckpoints = useRef<number | null>(null);
  useEffect(() => {
    const prev = lastCheckpoints.current;
    lastCheckpoints.current = myCheckpoints;
    if (prev == null || myCheckpoints == null || myCheckpoints <= prev) return;
    const delivered = mySideId != null && scores.goal === mySideId;
    Vibration.vibrate(delivered ? [0, 600, 200, 600, 200, 600] : [0, 300, 150, 300]);
  }, [myCheckpoints, mySideId, scores.goal]);

  // People on the map: techs for everyone (orange diamonds); every side's fighters for techs.
  const mapMembers = useMemo<Member[]>(() => {
    const out: Member[] = techs
      .filter((t) => t.uid !== uid && t.lat != null && t.lng != null)
      .map((t) => ({
        id: `tech/${t.uid}`,
        callsign: t.callsign,
        role: DEFAULT_ROLE,
        canCommand: false,
        status: 'alive',
        lat: t.lat,
        lng: t.lng,
        heading: t.heading,
        updatedAt: t.updatedAt,
        tech: true,
      }));
    if (!isTech) return out;
    for (const sd of sideDocs) {
      const color = sideColor(sd.id);
      for (const t of squads[sd.id] ?? []) {
        for (const m of squadMembers[t.id] ?? []) {
          const leader = m.canCommand || m.id === t.ownerId || m.id === sd.ownerId;
          if (!showAll && !leader) continue;
          out.push({ ...m, id: `${t.id}/${m.id}`, color, leader, teamId: t.id });
        }
      }
    }
    return out;
  }, [techs, uid, isTech, sideDocs, squads, squadMembers, showAll, sideColor]);

  const roster = useMemo<RosterSide[]>(
    () =>
      isTech
        ? sideDocs.map((sd) => ({
            id: sd.id,
            name: sideName(sd.id),
            color: sideColor(sd.id),
            squads: (squads[sd.id] ?? []).map((t) => ({
              id: t.id,
              name: t.name,
              color: sideColor(sd.id),
              members: (squadMembers[t.id] ?? []).map((m) => ({ ...m, id: `${t.id}/${m.id}`, teamId: t.id })),
            })),
          }))
        : [],
    [isTech, sideDocs, squads, squadMembers, sideName, sideColor]
  );

  // Moving convoys are written every ~12 s: tick every 3 s to move them in between.
  const ballsMoving = markers.some((m) => m.kind === 'ball' && (m.ball?.push ?? 0) > 0 && !m.ball?.goal);
  const matchRunning = Boolean(game?.match && !game.match.stoppedAt);
  const [ballClock, setBallClock] = useState(0);
  useEffect(() => {
    if (!ballsMoving || !matchRunning) return;
    const t = setInterval(() => setBallClock(Date.now()), BALL_TICK_MS);
    return () => clearInterval(t);
  }, [ballsMoving, matchRunning]);

  // Game markers, colored by who holds them.
  const shownMarkers = useMemo(
    () =>
      markers.map((m) => {
        if (m.kind === 'ball' && m.points?.length) {
          const b = m.ball;
          // Where the convoy is now at its last known speed, at most 15 s ahead of the write.
          const progress =
            b && b.push > 0 && !b.goal && matchRunning
              ? rollBall(b, pathLength(m.points), Math.min(Date.now(), b.at + 5 * BALL_TICK_MS), b.push).progress
              : (b?.progress ?? 0);
          const at = pointAlong(m.points, progress);
          return { ...m, lat: at.lat, lng: at.lng, color: sideColor(m.owner) };
        }
        return m.kind === 'flag' || m.kind === 'sector' ? { ...m, color: m.owner ? sideColor(m.owner) : undefined } : m;
      }),
    // ballClock re-runs this every 3 s while a convoy moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markers, sideColor, ballClock, matchRunning]
  );

  const requireUid = useCallback(() => {
    if (!uid) throw new Error('Нет подключения к серверу');
    return uid;
  }, [uid]);
  const requireGame = useCallback(() => {
    if (!gameId || !game) throw new Error('Игра не загружена');
    return game;
  }, [gameId, game]);

  const lastTechSent = useRef<{ at: number; p: LatLng } | null>(null);
  const reportPosition = useCallback(
    (p: SelfPosition) => {
      if (!isTech || !gameId || !uid) return;
      const now = Date.now();
      const last = lastTechSent.current;
      if (last && now - last.at < 30_000) return;
      lastTechSent.current = { at: now, p };
      games.reportTech(gameId, uid, { lat: p.lat, lng: p.lng, heading: p.heading }).catch(() => {});
    },
    [isTech, gameId, uid]
  );

  const value = useMemo<GameState>(
    () => ({
      gameId,
      game,
      isTech,
      isCreator,
      techs,
      sides: gameSides,
      sideDocs,
      players,
      markers: shownMarkers,
      mySideId,
      sideColor,
      sideName,
      scores,
      mapMembers,
      roster,
      showAll,
      setShowAll: async (v) => {
        setShowAllState(v);
        await saveJson(KEYS.techShowAll, v);
      },
      createGame: async (name) => {
        const id = await withTimeout(games.createGame(requireUid(), callsign || 'Игротех', name.trim() || 'Игра'));
        setTechGameId(id);
        await saveJson(KEYS.techGame, id);
      },
      joinAsTech: async (code) => {
        const id = await games.joinAsTech(requireUid(), callsign || 'Игротех', code);
        setTechGameId(id);
        await saveJson(KEYS.techGame, id);
      },
      leave: async () => {
        if (techGameId && uid) await games.leaveTech(techGameId, uid).catch(() => {});
        setTechGameId(null);
        await saveJson(KEYS.techGame, null);
      },
      removeTech: async (techUid) => {
        await games.leaveTech(requireGame().id, techUid);
      },
      attachSide: async (code) => {
        if (!side.side || !side.isSideCommander) throw new Error('Сначала создайте сторону');
        await games.attachSide(side.side, code, callsign);
      },
      detachSide: async (sideId) => {
        await games.detachSide(sideId);
      },
      createSide: async (name) => {
        const g = requireGame();
        return games.createSideInGame(g, requireUid(), name, SIDE_COLORS[gameSides.length % SIDE_COLORS.length]);
      },
      saveSide: async (s) => {
        await games.setGameSide(requireGame().id, s);
      },
      startMatch: async (minutes) => {
        const g = requireGame();
        const start = Date.now();
        // Balls back to their starting points.
        await Promise.all(
          balls.map((b) => games.updateGameMarker(g.id, b.id, { ball: { progress: 0, at: start, push: 0, goal: null } }))
        );
        await games.setMatch(g.id, { start, minutes: Math.round(minutes) });
      },
      stopMatch: async () => {
        const g = requireGame();
        if (g.match) await games.setMatch(g.id, { ...g.match, stoppedAt: Date.now() });
      },
      setTickets: async (n) => {
        await games.setTickets(requireGame().id, n);
      },
      setTiebreak: async (t) => {
        await games.setTiebreak(requireGame().id, t);
      },
      addZone: async (at, z, label) => {
        await games.addGameMarker(requireGame().id, {
          kind: 'hotzone',
          label,
          lat: at.lat,
          lng: at.lng,
          zone: z,
          createdBy: requireUid(),
          createdByName: callsign || 'Игротех',
        });
      },
      setZone: async (m, z) => {
        await games.updateGameMarker(requireGame().id, m.id, { zone: z });
      },
      addFlag: async (at, label) => {
        await games.addGameMarker(requireGame().id, {
          kind: 'flag',
          label,
          lat: at.lat,
          lng: at.lng,
          owner: null,
          log: [],
          createdBy: requireUid(),
          createdByName: callsign || 'Игротех',
        });
      },
      addTerritory: async (center, size) => {
        const g = requireGame();
        // One set of territories per game: the new one replaces the old.
        await Promise.all(sectors.map((s) => games.deleteGameMarker(g.id, s.id)));
        await games.addGameMarkers(
          g.id,
          territorySectors(center, size).map((s) => ({
            kind: 'sector' as const,
            label: String(s.n),
            lat: s.center.lat,
            lng: s.center.lng,
            points: s.points,
            owner: null,
            log: [],
            createdBy: requireUid(),
            createdByName: callsign || 'Игротех',
          }))
        );
      },
      resetTerritory: async () => {
        const g = requireGame();
        await Promise.all(sectors.map((s) => games.updateGameMarker(g.id, s.id, { owner: null, log: [], cap: null, min: null } as Partial<TacMarker>)));
      },
      addBall: async (sideId, points) => {
        const g = requireGame();
        // One ball per side: a new arrow replaces the old one.
        await Promise.all(balls.filter((b) => b.owner === sideId).map((b) => games.deleteGameMarker(g.id, b.id)));
        await games.addGameMarker(g.id, {
          kind: 'ball',
          label: sideName(sideId),
          lat: points[0].lat,
          lng: points[0].lng,
          points,
          owner: sideId,
          ball: { progress: 0, at: Date.now(), push: 0, goal: null },
          createdBy: requireUid(),
          createdByName: callsign || 'Игротех',
        });
      },
      deleteMarker: async (m) => {
        await games.deleteGameMarker(requireGame().id, m.id);
      },
      placeRequest,
      requestPlace,
      removeMode: async (k) => {
        const g = requireGame();
        const of = markers.filter((m) => (k === 'hotzone' ? Boolean(m.zone) : m.kind === k));
        await Promise.all(of.map((m) => games.deleteGameMarker(g.id, m.id)));
      },
      captureFlag: async (m) => {
        if (!mySideId) throw new Error('Вы не в игре');
        if (m.owner === mySideId) return;
        await games.setHolder(requireGame().id, m, mySideId, Date.now());
      },
      reportPosition,
      acceptInvite: async (invite) => {
        if (invite.kind === 'game') {
          const id = await games.joinAsTech(requireUid(), callsign || 'Игротех', invite.code);
          setTechGameId(id);
          await saveJson(KEYS.techGame, id);
          return 'Вы игротех этой игры';
        }
        if (invite.kind === 'gameside') {
          if (!side.side || !side.isSideCommander) {
            throw new Error('Сначала создайте сторону: Отряд → Сторона → «Создать сторону», затем отсканируйте код ещё раз');
          }
          await games.attachSide(side.side, invite.code, callsign);
          return 'Сторона в игре';
        }
        if (invite.kind === 'claim') {
          await games.claimSide(invite.sideId, requireUid(), invite.code);
          await side.adoptSide(invite.sideId);
          return 'Вы командир стороны';
        }
        return side.acceptInvite(invite);
      },
    }),
    [
      gameId,
      game,
      isTech,
      isCreator,
      techs,
      gameSides,
      sideDocs,
      players,
      shownMarkers,
      mySideId,
      sideColor,
      sideName,
      scores,
      mapMembers,
      roster,
      showAll,
      requireUid,
      requireGame,
      callsign,
      techGameId,
      uid,
      side,
      sectors,
      balls,
      reportPosition,
      placeRequest,
      markers,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
