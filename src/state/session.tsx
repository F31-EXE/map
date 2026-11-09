import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteUser, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { firebaseAuth, isFirebaseConfigured } from '../lib/firebase';
import { distanceMeters } from '../lib/geo';
import { isOrder, isVotedOut } from '../lib/markerKinds';
import { mergeMeshMarkers, mergeMeshMembers } from '../lib/mesh';
import { DEFAULT_ROLE, DEFAULT_TEAM_COLOR, roleOf, type RoleId } from '../lib/roles';
import {
  defaultFactions,
  pointsAt,
  scoreMinute,
  teamScores,
  validFaction,
  visibleTo,
  type Faction,
} from '../lib/game';
import { hotState, type HotZone } from '../lib/hotzone';
import {
  addPoint,
  dropSent,
  nextBatch,
  pendingKey,
  shouldSample,
  type PendingTracks,
} from '../lib/trackBuffer';
import type { TrackPoint } from '../lib/tracks';
import { nextWave, type Wave } from '../lib/waves';
import { KEYS, loadJson, newId, saveJson } from '../lib/storage';
import type { GridMode, LatLng, Member, MemberStatus, SelfPosition, TacMarker, Team } from '../lib/types';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Alert, Vibration } from 'react-native';

import { signalNewOrder } from '../services/orderAlert';
import { startBackgroundLocation, stopBackgroundLocation } from '../services/backgroundLocation';
import { checkSafeMode } from '../services/crashGuard';
import { deleteMyMessages } from '../services/chat';
import * as recordings from '../services/recordings';
import * as teams from '../services/teams';

import { useMesh, type Mesh } from './useMesh';

/** Re-send position at least this often so teammates can tell we're alive. */
const HEARTBEAT_MS = 30_000;
const MIN_INTERVAL_MS = 4_000;
const MIN_MOVE_M = 3;
const NOT_A_MEMBER = 'Вы больше не состоите в этой команде';

export type MarkerScope = 'team' | 'personal';

type Session = {
  ready: boolean;
  firebaseEnabled: boolean;
  uid: string | null;
  authError: string | null;

  callsign: string;
  setCallsign: (c: string) => Promise<void>;
  role: RoleId;
  setRole: (r: RoleId) => Promise<void>;
  /** Own avatar as a data URI. */
  avatar: string | null;
  setAvatar: (dataUri: string | null) => Promise<void>;
  /** Teammates' avatars by uid (includes our own while in a team). */
  avatars: Record<string, string>;

  teamId: string | null;
  team: Team | null;
  /** Team color, or the default when not in a team. */
  teamColor: string;
  members: Member[];
  teamError: string | null;
  isOwner: boolean;
  /** Owner, or granted command rights: may place orders. */
  canCommand: boolean;
  createTeam: (name: string) => Promise<void>;
  joinTeam: (code: string) => Promise<void>;
  leaveTeam: () => Promise<void>;
  kickMember: (memberId: string) => Promise<void>;
  setMemberCanCommand: (memberId: string, value: boolean) => Promise<void>;
  setTeamColor: (color: string) => Promise<void>;

  shareLocation: boolean;
  setShareLocation: (v: boolean) => Promise<void>;
  reportPosition: (p: SelfPosition) => void;

  orderSound: boolean;
  setOrderSound: (v: boolean) => Promise<void>;
  /** Phone-to-phone link without internet (Android). */
  mesh: Mesh;
  /** Position (and on Android the Bluetooth link) keep working with the screen off. */
  background: boolean;
  setBackground: (v: boolean) => Promise<void>;
  /** Screen stays on: position and Bluetooth keep working during the game. */
  keepAwake: boolean;
  setKeepAwake: (v: boolean) => Promise<void>;
  /** Coordinate grid on the map. */
  gridMode: GridMode;
  setGridMode: (v: GridMode) => Promise<void>;
  /** Snail grid origin (NW corner of А1): the squad's, or this phone's when solo. */
  gridOrigin: LatLng | null;
  /** Commanders (or anyone outside a squad) move square А1; null resets. */
  setGridOrigin: (p: LatLng | null) => Promise<void>;

  /** Own game state: alive, dead (waiting for respawn) or away. */
  status: MemberStatus;
  setStatus: (s: MemberStatus) => Promise<void>;
  /** Commanders: change a subordinate's role or status. */
  setMemberRole: (memberId: string, role: RoleId) => Promise<void>;
  setMemberStatus: (memberId: string, status: MemberStatus) => Promise<void>;
  /** Commanders: pin a chat message for the squad (null unpins). */
  pinMessage: (m: { id: string; text: string; callsign: string; uid: string; createdAt: number } | null) => Promise<void>;

  /** Team markers (when in a team) plus this device's personal ones. */
  markers: TacMarker[];
  addMarker: (m: Pick<TacMarker, 'kind' | 'label' | 'lat' | 'lng' | 'points' | 'color' | 'wave' | 'zone'>, scope: MarkerScope) => Promise<void>;
  deleteMarker: (m: TacMarker) => Promise<void>;
  /** Own markers only (personal, or placed by me in the squad). */
  moveMarker: (m: TacMarker, p: LatLng) => Promise<void>;
  voteMarker: (m: TacMarker, vote: 'stale' | 'done') => Promise<void>;
  /** Commanders: departure schedule on a respawn / dead-zone marker (null clears). */
  setMarkerWave: (m: TacMarker, wave: Wave | null) => Promise<void>;
  setMarkerZone: (m: TacMarker, zone: HotZone) => Promise<void>;
  /**
   * Deletes every team marker `allowed` accepts, hidden ones (voted out, commanders-only)
   * included. Returns how many were deleted.
   */
  clearTeamMarkers: (allowed: (m: TacMarker) => boolean) => Promise<{ deleted: number; failed: number }>;
  /**
   * Erases the user's data: their chat messages, tracks and avatar in the squad, their
   * membership, the anonymous account, and the profile kept on the phone. Needs internet.
   */
  deleteMyData: () => Promise<void>;

  /** Team game run by the squad creator (game master). */
  game: GameState;
  /** Game master: number of teams (0 ends the team game). */
  setFactionCount: (n: number) => Promise<void>;
  /** Game master: put a player into a team (null: none). */
  setMemberFaction: (memberId: string, faction: number | null) => Promise<void>;
};

export type GameState = {
  on: boolean;
  /** The squad creator: sees every team and the overall score. */
  isMaster: boolean;
  factions: Faction[];
  myFaction: number | null;
  /** Current control zone (newest `hotzone` marker) and the teams' points in it. */
  zoneId: string | null;
  scores: number[];
};

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession must be used inside <SessionProvider>');
  return s;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [callsign, setCallsignState] = useState('');
  const [role, setRoleState] = useState<RoleId>(DEFAULT_ROLE);
  const [avatar, setAvatarState] = useState<string | null>(null);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [teamId, setTeamId] = useState<string | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [shareLocation, setShareLocationState] = useState(true);
  const [orderSound, setOrderSoundState] = useState(true);
  const [gridMode, setGridModeState] = useState<GridMode>('off');
  const [localGridOrigin, setLocalGridOrigin] = useState<LatLng | null>(null);
  const [keepAwake, setKeepAwakeState] = useState(false);
  const [background, setBackgroundState] = useState(false);
  const [status, setStatusState] = useState<MemberStatus>('alive');
  const [teamMarkers, setTeamMarkers] = useState<TacMarker[]>([]);
  const [personalMarkers, setPersonalMarkers] = useState<TacMarker[]>([]);

  // Load persisted local state.
  useEffect(() => {
    (async () => {
      const [cs, r, av, tid, share, sound, personal, grid, st, awake, bg] = await Promise.all([
        loadJson<string>(KEYS.callsign, ''),
        loadJson<string>(KEYS.role, DEFAULT_ROLE),
        loadJson<string | null>(KEYS.avatar, null),
        loadJson<string | null>(KEYS.teamId, null),
        loadJson<boolean>(KEYS.shareLocation, true),
        loadJson<boolean>(KEYS.orderSound, true),
        loadJson<TacMarker[]>(KEYS.personalMarkers, []),
        // Older versions stored a plain on/off for the UTM grid.
        loadJson<boolean | GridMode>(KEYS.grid, false),
        loadJson<MemberStatus>(KEYS.status, 'alive'),
        loadJson<boolean>(KEYS.keepAwake, false),
        loadJson<boolean>(KEYS.background, false),
      ]);
      // Two crashes in a row at startup: come up with the native extras switched off.
      const safe = await checkSafeMode();
      if (safe && bg) {
        await saveJson(KEYS.background, false);
        stopBackgroundLocation().catch(() => {});
      }
      setBackgroundState(bg && !safe);
      if (safe) {
        Alert.alert(
          'Приложение аварийно закрывалось',
          'Связь без интернета и работа в фоне выключены. Включите их снова в настройках; если сбой повторится, отправьте разработчику текст ошибки из настроек.'
        );
      } else if (bg) {
        // Permissions were granted when it was switched on; resume once the app is up.
        setTimeout(() => startBackgroundLocation().catch(() => {}), 4000);
      }
      setKeepAwakeState(awake);
      setGridModeState(grid === true ? 'utm' : grid === 'utm' || grid === 'snail' ? grid : 'off');
      loadJson<LatLng | null>(KEYS.gridOrigin, null).then(setLocalGridOrigin);
      setStatusState(st === 'dead' || st === 'afk' ? st : 'alive');
      setCallsignState(cs);
      setRoleState(roleOf(r));
      setAvatarState(av);
      setTeamId(tid);
      setShareLocationState(share);
      setOrderSoundState(sound);
      setPersonalMarkers(personal.map((m) => ({ ...m, personal: true })));
      setReady(true);
    })();
  }, []);

  // Anonymous Firebase identity: no accounts to manage at the field.
  useEffect(() => {
    if (!isFirebaseConfigured) return;
    const auth = firebaseAuth();
    return onAuthStateChanged(auth, (user) => {
      if (user) {
        setUid(user.uid);
        setAuthError(null);
      } else {
        signInAnonymously(auth).catch((e: Error) => setAuthError(e.message));
      }
    });
  }, []);

  const persistTeamId = useCallback(async (id: string | null) => {
    setTeamId(id);
    await saveJson(KEYS.teamId, id);
  }, []);

  // Read inside the markers listener without resubscribing when it changes.
  const orderSoundRef = useRef(orderSound);
  orderSoundRef.current = orderSound;
  const canCommandRef = useRef(false);
  /** Orders that already buzzed (over the server or the mesh). */
  const buzzed = useRef(new Set<string>());

  // Live team subscriptions.
  useEffect(() => {
    if (!teamId || !uid) {
      setTeam(null);
      setMembers([]);
      setTeamMarkers([]);
      setAvatars({});
      return;
    }
    setTeamError(null);
    let active = true;
    let checking = false;
    // Orders already on the map when we connect don't buzz; only new ones do.
    let seenOrders: Set<string> | null = null;
    const onError = (e: Error) => setTeamError(teams.isPermissionDenied(e) ? NOT_A_MEMBER : e.message);
    const unsubs = [
      teams.subscribeTeam(teamId, setTeam, onError),
      teams.subscribeMembers(
        teamId,
        (list) => {
          setMembers(list);
          if (list.some((m) => m.id === uid)) {
            setTeamError((e) => (e === NOT_A_MEMBER ? null : e));
            return;
          }
          // Possibly kicked, or left from another device — confirm with the server.
          if (checking) return;
          checking = true;
          teams
            .isMember(teamId, uid)
            .then((member) => {
              if (active && !member) setTeamError(NOT_A_MEMBER);
            })
            .catch(() => {})
            .finally(() => {
              checking = false;
            });
        },
        onError
      ),
      teams.subscribeTeamMarkers(
        teamId,
        (list) => {
          setTeamMarkers(list);
          const orders = list.filter((m) => isOrder(m.kind));
          if (seenOrders) {
            const fresh = orders.filter(
              (m) =>
                !seenOrders!.has(m.id) &&
                m.createdBy !== uid &&
                // Side orders reach squad commanders only.
                (m.audience !== 'commanders' || canCommandRef.current)
            );
            // Orders that already buzzed when they arrived over Bluetooth stay quiet.
            const unheard = fresh.filter((m) => !buzzed.current.has(m.id));
            unheard.forEach((m) => buzzed.current.add(m.id));
            if (unheard.length) signalNewOrder(orderSoundRef.current);
          }
          seenOrders = new Set(orders.map((m) => m.id));
        },
        onError
      ),
      teams.subscribeAvatars(teamId, setAvatars, () => {}),
    ];
    return () => {
      active = false;
      unsubs.forEach((u) => u());
    };
  }, [teamId, uid]);

  const inTeam = Boolean(teamId && uid);
  const me = members.find((m) => m.id === uid);
  const isOwner = Boolean(team && uid && team.ownerId === uid);
  const canCommand = inTeam && (isOwner || Boolean(me?.canCommand));
  canCommandRef.current = canCommand;

  // Team game: players see only their own team; the creator runs the game and sees all.
  const factions = useMemo(() => team?.factions ?? [], [team?.factions]);
  const gameOn = inTeam && factions.length > 0;
  // The creator runs the game (and may start it, so this holds before it is on too).
  const isMaster = inTeam && isOwner;
  const myFaction =
    gameOn && !isOwner && validFaction(me?.faction, factions.length) ? (me!.faction as number) : null;
  const viewer = useMemo(() => ({ gameOn, isMaster, faction: myFaction }), [gameOn, isMaster, myFaction]);

  const mesh = useMesh({
    teamId,
    uid,
    callsign,
    role,
    status,
    canCommand,
    onNewMark: (m) => {
      if (!isOrder(m.kind as TacMarker['kind']) || buzzed.current.has(m.id)) return;
      if (m.audience === 'commanders' && !canCommandRef.current) return;
      buzzed.current.add(m.id);
      signalNewOrder(orderSoundRef.current);
    },
  });
  // Positions and statuses heard over Bluetooth fill in while the server is out of reach.
  const allMembers = useMemo(
    () => (mesh.positions.length ? mergeMeshMembers(members, mesh.positions) : members),
    [members, mesh.positions]
  );
  const shownMembers = useMemo(
    () =>
      gameOn
        ? allMembers
            .map((m) =>
              // The game master is not on any team.
              m.id === team?.ownerId ? { ...m, faction: null } : m
            )
            .filter((m) => m.id === uid || visibleTo(viewer, validFaction(m.faction, factions.length) ? m.faction : -1))
            .map((m) => (validFaction(m.faction, factions.length) ? { ...m, color: factions[m.faction].color } : m))
        : allMembers,
    [allMembers, gameOn, viewer, factions, uid, team?.ownerId]
  );
  // Markers created, moved, deleted or voted on over Bluetooth, on top of the server's.
  const shownTeamMarkers = useMemo(
    () =>
      teamId && (mesh.marks.length || mesh.votes.length)
        ? mergeMeshMarkers(teamMarkers, mesh.marks, mesh.votes, teamId)
        : teamMarkers,
    [teamMarkers, mesh.marks, mesh.votes, teamId]
  );

  // Gateway: once this phone reaches the server, upload markers others placed while
  // offline that only we heard about. Waits a bit so their own upload usually wins.
  const relayedMarks = useRef(new Set<string>());
  useEffect(() => {
    if (!teamId || !uid) return;
    const todo = shownTeamMarkers.filter((m) => m.viaMesh && m.createdBy !== uid && m.kind !== 'hotzone' && !relayedMarks.current.has(m.id));
    if (!todo.length) return;
    const t = setTimeout(() => {
      for (const m of todo) {
        relayedMarks.current.add(m.id);
        teams.relayTeamMarker(teamId, uid, m).catch(() => {});
      }
    }, 20_000);
    return () => clearTimeout(t);
  }, [shownTeamMarkers, teamId, uid]);

  // A commander may change my role or status; the member doc wins over local state.
  const myRole = me?.role;
  const myStatus = me?.status;
  useEffect(() => {
    if (!myRole) return;
    setRoleState(myRole);
    saveJson(KEYS.role, myRole).catch(() => {});
  }, [myRole]);
  useEffect(() => {
    if (!myStatus) return;
    setStatusState(myStatus);
    saveJson(KEYS.status, myStatus).catch(() => {});
  }, [myStatus]);

  // Squad writes don't wait for the server: offline, Firestore keeps them queued and the
  // mesh carries them to nearby phones meanwhile. A refusal shows up when it comes.
  const fireAndReport = useCallback((p: Promise<unknown>, what: string) => {
    p.catch((e: unknown) => Alert.alert(what, teams.markerErrorText(e)));
  }, []);

  const requireUid = useCallback(() => {
    if (!uid) throw new Error(authError ?? 'Нет подключения к серверу');
    return uid;
  }, [uid, authError]);

  const requireCallsign = useCallback(() => {
    const c = callsign.trim();
    if (!c) throw new Error('Сначала укажите позывной');
    return c;
  }, [callsign]);

  const setCallsign = useCallback(
    async (c: string) => {
      const v = c.trim().slice(0, 24);
      setCallsignState(v);
      await saveJson(KEYS.callsign, v);
      if (teamId && uid && v) fireAndReport(teams.updateProfile(teamId, uid, { callsign: v }), 'Позывной не сохранился');
    },
    [teamId, uid]
  );

  const setRole = useCallback(
    async (r: RoleId) => {
      setRoleState(r);
      await saveJson(KEYS.role, r);
      if (teamId && uid) fireAndReport(teams.updateProfile(teamId, uid, { role: r }), 'Роль не сохранилась');
    },
    [teamId, uid]
  );

  const setAvatar = useCallback(
    async (dataUri: string | null) => {
      setAvatarState(dataUri);
      await saveJson(KEYS.avatar, dataUri);
      if (teamId && uid) fireAndReport(teams.setAvatar(teamId, uid, dataUri), 'Аватар не сохранился');
    },
    [teamId, uid, fireAndReport]
  );

  // Publish the locally chosen avatar when joining a team (or after reinstalling).
  useEffect(() => {
    if (!teamId || !uid || !avatar) return;
    teams.setAvatar(teamId, uid, avatar).catch(() => {});
  }, [teamId, uid, avatar]);

  const createTeam = useCallback(
    async (name: string) => {
      const id = await teams.createTeam(requireUid(), requireCallsign(), role, name.trim() || 'Команда');
      await persistTeamId(id);
    },
    [requireUid, requireCallsign, role, persistTeamId]
  );

  const joinTeam = useCallback(
    async (code: string) => {
      const id = await teams.joinTeam(requireUid(), requireCallsign(), role, code);
      await persistTeamId(id);
    },
    [requireUid, requireCallsign, role, persistTeamId]
  );

  const leaveTeam = useCallback(async () => {
    if (teamId && uid) {
      // Offline these settle only on reconnect; don't keep the button spinning meanwhile.
      // Already removed — fine, the team is forgotten locally either way.
      const tid = teamId;
      teams
        .setAvatar(tid, uid, null)
        .then(() => teams.leaveTeam(tid, uid))
        .catch(() => {});
    }
    await persistTeamId(null);
  }, [teamId, uid, persistTeamId]);

  const kickMember = useCallback(
    async (memberId: string) => {
      if (teamId) await teams.kickMember(teamId, memberId);
    },
    [teamId]
  );

  const setMemberCanCommand = useCallback(
    async (memberId: string, value: boolean) => {
      if (teamId) await teams.setCanCommand(teamId, memberId, value);
    },
    [teamId]
  );

  const setStatus = useCallback(
    async (st: MemberStatus) => {
      setStatusState(st);
      await saveJson(KEYS.status, st);
      if (teamId && uid) fireAndReport(teams.updateProfile(teamId, uid, { status: st }), 'Статус не сохранился');
    },
    [teamId, uid]
  );

  const setMemberRole = useCallback(
    async (memberId: string, r: RoleId) => {
      if (memberId === uid) return setRole(r);
      if (teamId) fireAndReport(teams.updateMemberByCommander(teamId, memberId, { role: r }), 'Роль не сохранилась');
    },
    [teamId, uid, setRole]
  );

  const setMemberStatus = useCallback(
    async (memberId: string, st: MemberStatus) => {
      if (memberId === uid) return setStatus(st);
      if (teamId) fireAndReport(teams.updateMemberByCommander(teamId, memberId, { status: st }), 'Статус не сохранился');
    },
    [teamId, uid, setStatus]
  );

  const pinMessage = useCallback(
    async (m: { id: string; text: string; callsign: string; uid: string; createdAt: number } | null) => {
      if (!teamId) return;
      await teams.setPinned(
        teamId,
        m && { id: m.id, text: m.text.slice(0, 500), callsign: m.callsign, uid: m.uid, at: m.createdAt }
      );
    },
    [teamId]
  );

  const setBackground = useCallback(async (v: boolean) => {
    if (v) {
      const ok = await startBackgroundLocation();
      if (!ok) {
        throw new Error(
          'Нужно разрешение на геолокацию «Разрешить всегда». Откройте настройки приложения → Разрешения → Местоположение.'
        );
      }
    } else {
      await stopBackgroundLocation();
    }
    setBackgroundState(v);
    await saveJson(KEYS.background, v);
  }, []);

  const setKeepAwake = useCallback(async (v: boolean) => {
    setKeepAwakeState(v);
    await saveJson(KEYS.keepAwake, v);
  }, []);

  useEffect(() => {
    if (!keepAwake) return;
    activateKeepAwakeAsync('grimmap').catch(() => {});
    return () => {
      deactivateKeepAwake('grimmap').catch(() => {});
    };
  }, [keepAwake]);

  const setGridMode = useCallback(async (v: GridMode) => {
    setGridModeState(v);
    await saveJson(KEYS.grid, v);
  }, []);

  const gridOrigin = teamId ? (team?.grid ?? null) : localGridOrigin;
  const setGridOrigin = useCallback(
    async (p: LatLng | null) => {
      const v = p && { lat: p.lat, lng: p.lng };
      if (teamId) await teams.setGridOrigin(teamId, v);
      else {
        setLocalGridOrigin(v);
        await saveJson(KEYS.gridOrigin, v);
      }
    },
    [teamId]
  );

  const setTeamColor = useCallback(
    async (color: string) => {
      if (teamId) await teams.setTeamColor(teamId, color);
    },
    [teamId]
  );

  // Active recording: from the team doc, or as last seen when the app starts without
  // a connection (the team doc then never arrives).
  const [savedRecording, setSavedRecording] = useState<{ teamId: string; recId: string | null } | null>(null);
  useEffect(() => {
    loadJson<{ teamId: string; recId: string | null } | null>(KEYS.recording, null).then(setSavedRecording);
  }, []);
  const liveRecording = team && team.id === teamId ? (team.recordingId ?? null) : undefined;
  useEffect(() => {
    if (teamId && liveRecording !== undefined) {
      saveJson(KEYS.recording, { teamId, recId: liveRecording }).catch(() => {});
    }
  }, [teamId, liveRecording]);
  // Read inside reportPosition without re-creating it on every change.
  const recordingRef = useRef<string | null>(null);
  recordingRef.current =
    liveRecording !== undefined ? liveRecording : savedRecording?.teamId === teamId ? savedRecording.recId : null;
  const profileRef = useRef({ callsign, role });
  profileRef.current = { callsign: callsign || 'Боец', role };

  // Movement recording: points are queued on the phone and uploaded in batches, so a
  // route walked without a connection is sent once the phone is back online.
  const pendingTracks = useRef<PendingTracks>({});
  const lastTrackPoint = useRef<TrackPoint | null>(null);
  const uploadingTracks = useRef(false);
  const savePendingTracks = useCallback(() => {
    saveJson(KEYS.pendingTracks, pendingTracks.current).catch(() => {});
  }, []);
  const flushTracks = useRef<() => void>(() => {});
  flushTracks.current = () => {
    if (uploadingTracks.current || !uid) return;
    const batch = nextBatch(pendingTracks.current);
    if (!batch) return;
    const [tid, recId] = batch.key.split('/');
    uploadingTracks.current = true;
    // Offline this only settles once the connection is back; points keep queuing meanwhile.
    recordings
      .appendTrackPoints(tid, recId, uid, profileRef.current, batch.points)
      .then(() => {
        pendingTracks.current = dropSent(pendingTracks.current, batch.key, batch.points);
        savePendingTracks();
        uploadingTracks.current = false;
        flushTracks.current();
      })
      .catch((e: { code?: string }) => {
        uploadingTracks.current = false;
        // No longer allowed (left the squad): these points can't go anywhere.
        if (e?.code === 'permission-denied') {
          pendingTracks.current = dropSent(pendingTracks.current, batch.key, batch.points);
          savePendingTracks();
        }
      });
  };
  useEffect(() => {
    loadJson<PendingTracks>(KEYS.pendingTracks, {}).then((stored) => {
      // Points recorded before the load finished go after the stored ones.
      const merged: PendingTracks = { ...stored };
      for (const [k, list] of Object.entries(pendingTracks.current)) merged[k] = [...(merged[k] ?? []), ...list];
      pendingTracks.current = merged;
      flushTracks.current();
    });
    const t = setInterval(() => flushTracks.current(), 20_000);
    return () => clearInterval(t);
  }, []);
  // Signed in (or back from a refused upload): send what's waiting.
  useEffect(() => {
    if (uid) flushTracks.current();
  }, [uid]);
  const recordTrack = useCallback(
    (p: SelfPosition) => {
      const recId = recordingRef.current;
      if (!recId || !teamId) return;
      const now = Date.now();
      if (!shouldSample(lastTrackPoint.current, p, now)) return;
      const point = { lat: p.lat, lng: p.lng, t: now };
      lastTrackPoint.current = point;
      pendingTracks.current = addPoint(pendingTracks.current, pendingKey(teamId, recId), point);
      savePendingTracks();
      flushTracks.current();
    },
    [teamId, savePendingTracks]
  );

  // Latest own fix, for team game scoring.
  const lastFix = useRef<SelfPosition | null>(null);
  // Throttled position publishing.
  const lastSent = useRef<{ at: number; pos: SelfPosition } | null>(null);
  const inFlight = useRef(false);

  const { reportSelf } = mesh;
  const reportPosition = useCallback(
    (p: SelfPosition) => {
      lastFix.current = p;
      if (shareLocation) reportSelf(p);
      if (shareLocation) recordTrack(p);
      if (!teamId || !uid || !shareLocation || inFlight.current) return;
      const last = lastSent.current;
      const now = Date.now();
      if (last) {
        const elapsed = now - last.at;
        if (elapsed < MIN_INTERVAL_MS) return;
        if (elapsed < HEARTBEAT_MS && distanceMeters(last.pos, p) < MIN_MOVE_M) return;
      }
      inFlight.current = true;
      teams
        .publishPosition(teamId, uid, p)
        .then(() => {
          lastSent.current = { at: now, pos: p };
        })
        .catch(() => {})
        .finally(() => {
          inFlight.current = false;
        });
    },
    [teamId, uid, shareLocation, reportSelf, recordTrack]
  );

  useEffect(() => {
    lastSent.current = null;
  }, [teamId]);

  const setShareLocation = useCallback(
    async (v: boolean) => {
      setShareLocationState(v);
      await saveJson(KEYS.shareLocation, v);
      if (!v && teamId && uid) teams.clearPosition(teamId, uid).catch(() => {});
      lastSent.current = null;
    },
    [teamId, uid]
  );

  const setOrderSound = useCallback(async (v: boolean) => {
    setOrderSoundState(v);
    await saveJson(KEYS.orderSound, v);
  }, []);

  const savePersonal = useCallback(async (next: TacMarker[]) => {
    setPersonalMarkers(next);
    await saveJson(KEYS.personalMarkers, next);
  }, []);

  const { sendMark, sendVote } = mesh;

  const addMarker = useCallback(
    async (m: Pick<TacMarker, 'kind' | 'label' | 'lat' | 'lng' | 'points' | 'color' | 'wave' | 'zone'>, scope: MarkerScope) => {
      const base = {
        ...m,
        label: m.label.trim().slice(0, 40),
        createdByName: callsign || 'Я',
        // A player's markers stay within their team; the master's are for everyone.
        ...(gameOn && !isMaster && myFaction != null ? { faction: myFaction } : {}),
      };
      if (scope === 'team' && teamId && uid) {
        const id = teams.newMarkerId(teamId);
        sendMark({ ...base, id, createdBy: uid, createdAt: Date.now(), teamId });
        fireAndReport(teams.addTeamMarker(teamId, { ...base, createdBy: uid }, id), 'Метка не сохранилась на сервере');
      } else {
        await savePersonal([
          ...personalMarkers,
          { ...base, id: newId(), createdBy: 'local', createdAt: Date.now(), personal: true },
        ]);
      }
    },
    [teamId, uid, callsign, personalMarkers, savePersonal, sendMark, fireAndReport, gameOn, isMaster, myFaction]
  );

  const deleteMarker = useCallback(
    async (m: TacMarker) => {
      if (m.personal) await savePersonal(personalMarkers.filter((x) => x.id !== m.id));
      else if (teamId) {
        sendMark(m, true);
        fireAndReport(teams.deleteTeamMarker(teamId, m.id), 'Метка не удалилась на сервере');
      }
    },
    [teamId, personalMarkers, savePersonal, sendMark, fireAndReport]
  );

  const moveMarker = useCallback(
    async (m: TacMarker, p: LatLng) => {
      if (m.personal) {
        await savePersonal(personalMarkers.map((x) => (x.id === m.id ? { ...x, lat: p.lat, lng: p.lng } : x)));
      } else if (teamId) {
        sendMark({ ...m, lat: p.lat, lng: p.lng });
        fireAndReport(teams.moveTeamMarker(teamId, m.id, p.lat, p.lng), 'Метка не переместилась на сервере');
      }
    },
    [teamId, personalMarkers, savePersonal, sendMark, fireAndReport]
  );

  const voteMarker = useCallback(
    async (m: TacMarker, vote: 'stale' | 'done') => {
      if (!teamId || !uid || m.personal) return;
      sendVote({ markId: m.id, uid, vote });
      fireAndReport(teams.voteMarker(teamId, m.id, uid, vote), 'Голос не дошёл до сервера');
    },
    [teamId, uid, sendVote, fireAndReport]
  );

  const setMarkerWave = useCallback(
    async (m: TacMarker, wave: Wave | null) => {
      if (!teamId || m.personal) return;
      sendMark({ ...m, wave });
      fireAndReport(teams.setMarkerWave(teamId, m.id, wave), 'Расписание респа не сохранилось');
    },
    [teamId, sendMark, fireAndReport]
  );

  const setMarkerZone = useCallback(
    async (m: TacMarker, zone: HotZone) => {
      if (!teamId || m.personal) return;
      sendMark({ ...m, zone });
      fireAndReport(teams.setMarkerZone(teamId, m.id, zone), 'Настройки зоны не сохранились');
    },
    [teamId, sendMark, fireAndReport]
  );

  const clearTeamMarkers = useCallback(
    async (allowed: (m: TacMarker) => boolean) => {
      if (!teamId) return { deleted: 0, failed: 0 };
      const list = shownTeamMarkers.filter(allowed);
      list.forEach((m) => sendMark(m, true));
      // Don't hold the screen until the server answers (it may be out of reach);
      // report refusals when they come.
      teams
        .deleteTeamMarkers(
          teamId,
          list.map((m) => m.id)
        )
        .then((failed) => {
          if (failed) {
            Alert.alert(
              `Не удалось удалить ${failed}`,
              'Сервер не разрешил удалить часть меток. Скорее всего, в Firebase опубликованы старые правила доступа: обновите firestore.rules.'
            );
          }
        });
      return { deleted: list.length, failed: 0 };
    },
    [teamId, shownTeamMarkers, sendMark]
  );

  const deleteMyData = useCallback(async () => {
    const offline = () => new Error('Нет связи с сервером. Подключитесь к интернету и повторите.');
    const withTimeout = <T,>(p: Promise<T>) =>
      Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(offline()), 20_000))]);
    if (teamId && uid) {
      // While still a member: the rules only let squad members delete their own things.
      await withTimeout(
        Promise.all([
          deleteMyMessages(teamId, uid),
          recordings.deleteMyTracks(teamId, uid),
          teams.setAvatar(teamId, uid, null),
        ])
      );
      await withTimeout(teams.leaveTeam(teamId, uid));
    }
    if (isFirebaseConfigured) {
      const user = firebaseAuth().currentUser;
      // A fresh anonymous account is created right after (onAuthStateChanged).
      if (user) await withTimeout(deleteUser(user));
    }
    // Profile and game data on the phone; downloaded maps and display settings stay.
    const keep = new Set<string>([
      KEYS.offlineAreas,
      KEYS.overlays,
      KEYS.baseLayer,
      KEYS.regionPrompted,
      KEYS.grid,
      KEYS.gridOrigin,
      KEYS.keepAwake,
      KEYS.orderSound,
    ]);
    const all = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(all.filter((k) => !keep.has(k)));
    pendingTracks.current = {};
    setTeamId(null);
    setCallsignState('');
    setAvatarState(null);
    setRoleState(DEFAULT_ROLE);
    setStatusState('alive');
    setPersonalMarkers([]);
    setSavedRecording(null);
  }, [teamId, uid]);

  const markers = useMemo(
    () =>
      inTeam
        ? [
            ...shownTeamMarkers.filter(
              (m) =>
                (m.audience !== 'commanders' || canCommand) &&
                !isVotedOut(m, members.length) &&
                visibleTo(viewer, m.faction)
            ),
            ...personalMarkers,
          ]
        : personalMarkers,
    [inTeam, shownTeamMarkers, personalMarkers, canCommand, members.length, viewer]
  );

  // Waiting at the respawn: buzz a minute before the next departure and again when it
  // leaves, so a "dead" fighter doesn't have to stare at the countdown.
  const waveMarkers = useMemo(() => markers.filter((m) => m.wave), [markers]);
  // Kept across marker updates so a departure doesn't buzz twice.
  const firedWaves = useRef(new Set<string>());
  useEffect(() => {
    if (status !== 'dead' || !waveMarkers.length) return;
    const fired = firedWaves.current;
    const t = setInterval(() => {
      const now = Date.now();
      for (const m of waveMarkers) {
        const at = nextWave(m.wave!, now);
        const left = at - now;
        const warnKey = `${m.id}:${at}:warn`;
        if (left <= 60_000 && left > 55_000 && !fired.has(warnKey)) {
          fired.add(warnKey);
          Vibration.vibrate([0, 250, 150, 250]);
        }
        // nextWave() has already rolled over to the following departure right after one.
        const prev = at - m.wave!.every;
        const goKey = `${m.id}:${prev}:go`;
        if (now - prev >= 0 && now - prev < 5_000 && !fired.has(goKey)) {
          fired.add(goKey);
          signalNewOrder(orderSoundRef.current);
        }
      }
    }, 1000);
    return () => clearInterval(t);
  }, [status, waveMarkers]);

  // Hot zone: buzz when its next spot appears on the map and when it starts sliding.
  const zoneMarkers = useMemo(() => markers.filter((m) => m.zone), [markers]);
  // Kept across marker updates, which would otherwise hide a phase change.
  const zonePhases = useRef(new Map<string, string>());
  useEffect(() => {
    if (!zoneMarkers.length) return;
    const seen = zonePhases.current;
    const t = setInterval(() => {
      const now = Date.now();
      for (const m of zoneMarkers) {
        const st = hotState(m, m.zone!, now);
        const key = `${st.k}:${st.phase}`;
        const prev = seen.get(m.id);
        seen.set(m.id, key);
        // Only on a change seen live, not when the app opens mid-phase.
        if (prev == null || prev === key) continue;
        if (st.phase === 'warn') Vibration.vibrate([0, 400, 200, 400]);
        else if (st.phase === 'move') Vibration.vibrate([0, 200, 120, 200, 120, 200]);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [zoneMarkers]);

  // Team game scoring: the newest control zone counts; each phone adds its own player's
  // points once a minute (2 in the hot zone, 1 in the control zone), from its last fix.
  const gameZone = useMemo(
    () =>
      gameOn
        ? shownTeamMarkers
            .filter((m) => m.zone)
            .reduce<TacMarker | null>((a, m) => (!a || m.createdAt > a.createdAt ? m : a), null)
        : null,
    [gameOn, shownTeamMarkers]
  );
  // The game master never plays for a team, even if once put into one.
  const ownerId = team?.ownerId;
  const scores = useMemo(
    () =>
      gameZone
        ? teamScores(
            allMembers.filter((m) => m.id !== ownerId),
            gameZone.id,
            factions.length
          )
        : factions.map(() => 0),
    [gameZone, allMembers, factions, ownerId]
  );
  const game = useMemo<GameState>(
    () => ({ on: gameOn, isMaster, factions, myFaction, zoneId: gameZone?.id ?? null, scores }),
    [gameOn, isMaster, factions, myFaction, gameZone, scores]
  );
  const scoredMinutes = useRef<Record<string, number> | null>(null);
  useEffect(() => {
    loadJson<Record<string, number>>(KEYS.zoneTicks, {}).then((v) => {
      scoredMinutes.current = { ...v, ...(scoredMinutes.current ?? {}) };
    });
  }, []);
  useEffect(() => {
    if (!gameZone?.zone || myFaction == null || isMaster || !teamId || !uid || status === 'dead') return;
    const zone = gameZone.zone;
    const t = setInterval(() => {
      const seen = scoredMinutes.current;
      if (!seen) return;
      const now = Date.now();
      const minute = scoreMinute(zone, now);
      const last = seen[gameZone.id];
      if (last != null && minute <= last) return;
      seen[gameZone.id] = minute;
      saveJson(KEYS.zoneTicks, seen).catch(() => {});
      // The first look at a zone only starts the clock; points from the next minute on.
      if (last == null || minute < 1) return;
      const pos = lastFix.current;
      // A player standing still gets no new fixes, so the last one stays valid for a while.
      if (!pos || now - pos.timestamp > 10 * 60_000) return;
      const n = pointsAt(pos, gameZone, zone, hotState(gameZone, zone, now));
      if (n > 0) teams.addPoints(teamId, uid, gameZone.id, n).catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [gameZone, myFaction, isMaster, teamId, uid, status]);

  const setFactionCount = useCallback(
    async (n: number) => {
      if (teamId) await teams.setFactions(teamId, n > 0 ? defaultFactions(n) : null);
    },
    [teamId]
  );
  const setMemberFaction = useCallback(
    async (memberId: string, f: number | null) => {
      if (teamId) fireAndReport(teams.setMemberFaction(teamId, memberId, f), 'Команда игрока не сохранилась');
    },
    [teamId, fireAndReport]
  );

  const value = useMemo<Session>(
    () => ({
      ready,
      firebaseEnabled: isFirebaseConfigured,
      uid,
      authError,
      callsign,
      setCallsign,
      role,
      setRole,
      avatar,
      setAvatar,
      avatars,
      teamId,
      team,
      teamColor: myFaction != null ? factions[myFaction].color : (team?.color ?? DEFAULT_TEAM_COLOR),
      members: shownMembers,
      mesh,
      teamError,
      isOwner,
      canCommand,
      createTeam,
      joinTeam,
      leaveTeam,
      kickMember,
      setMemberCanCommand,
      setTeamColor,
      shareLocation,
      setShareLocation,
      reportPosition,
      orderSound,
      setOrderSound,
      gridMode,
      setGridMode,
      gridOrigin,
      setGridOrigin,
      keepAwake,
      setKeepAwake,
      background,
      setBackground,
      status,
      setStatus,
      setMemberRole,
      setMemberStatus,
      pinMessage,
      markers,
      addMarker,
      deleteMarker,
      moveMarker,
      voteMarker,
      setMarkerWave,
      setMarkerZone,
      clearTeamMarkers,
      deleteMyData,
      game,
      setFactionCount,
      setMemberFaction,
    }),
    [
      ready,
      uid,
      authError,
      callsign,
      setCallsign,
      role,
      setRole,
      avatar,
      setAvatar,
      avatars,
      teamId,
      team,
      factions,
      myFaction,
      shownMembers,
      mesh,
      teamError,
      isOwner,
      canCommand,
      createTeam,
      joinTeam,
      leaveTeam,
      kickMember,
      setMemberCanCommand,
      setTeamColor,
      shareLocation,
      setShareLocation,
      reportPosition,
      orderSound,
      setOrderSound,
      gridMode,
      setGridMode,
      gridOrigin,
      setGridOrigin,
      keepAwake,
      setKeepAwake,
      background,
      setBackground,
      status,
      setStatus,
      setMemberRole,
      setMemberStatus,
      pinMessage,
      markers,
      addMarker,
      deleteMarker,
      moveMarker,
      voteMarker,
      setMarkerWave,
      setMarkerZone,
      clearTeamMarkers,
      deleteMyData,
      game,
      setFactionCount,
      setMemberFaction,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
