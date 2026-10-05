import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
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
import { nextWave, type Wave } from '../lib/waves';
import { KEYS, loadJson, newId, saveJson } from '../lib/storage';
import type { LatLng, Member, MemberStatus, SelfPosition, TacMarker, Team } from '../lib/types';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Alert, Vibration } from 'react-native';

import { signalNewOrder } from '../services/orderAlert';
import { startBackgroundLocation, stopBackgroundLocation } from '../services/backgroundLocation';
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
  showGrid: boolean;
  setShowGrid: (v: boolean) => Promise<void>;

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
  addMarker: (m: Pick<TacMarker, 'kind' | 'label' | 'lat' | 'lng' | 'points' | 'color'>, scope: MarkerScope) => Promise<void>;
  deleteMarker: (m: TacMarker) => Promise<void>;
  /** Own markers only (personal, or placed by me in the squad). */
  moveMarker: (m: TacMarker, p: LatLng) => Promise<void>;
  voteMarker: (m: TacMarker, vote: 'stale' | 'done') => Promise<void>;
  /** Commanders: departure schedule on a respawn / dead-zone marker (null clears). */
  setMarkerWave: (m: TacMarker, wave: Wave | null) => Promise<void>;
  /**
   * Deletes every team marker `allowed` accepts, hidden ones (voted out, commanders-only)
   * included. Returns how many were deleted.
   */
  clearTeamMarkers: (allowed: (m: TacMarker) => boolean) => Promise<{ deleted: number; failed: number }>;
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
  const [showGrid, setShowGridState] = useState(false);
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
        loadJson<boolean>(KEYS.grid, false),
        loadJson<MemberStatus>(KEYS.status, 'alive'),
        loadJson<boolean>(KEYS.keepAwake, false),
        loadJson<boolean>(KEYS.background, false),
      ]);
      setBackgroundState(bg);
      // Permissions were granted when it was switched on; just resume.
      if (bg) startBackgroundLocation().catch(() => {});
      setKeepAwakeState(awake);
      setShowGridState(grid);
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
  const shownMembers = useMemo(
    () => (mesh.positions.length ? mergeMeshMembers(members, mesh.positions) : members),
    [members, mesh.positions]
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
    const todo = shownTeamMarkers.filter((m) => m.viaMesh && m.createdBy !== uid && !relayedMarks.current.has(m.id));
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
      if (teamId && uid) await teams.setAvatar(teamId, uid, dataUri);
    },
    [teamId, uid]
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
      try {
        await teams.setAvatar(teamId, uid, null);
        await teams.leaveTeam(teamId, uid);
      } catch {
        // Already removed — still forget the team locally.
      }
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

  const setShowGrid = useCallback(async (v: boolean) => {
    setShowGridState(v);
    await saveJson(KEYS.grid, v);
  }, []);

  const setTeamColor = useCallback(
    async (color: string) => {
      if (teamId) await teams.setTeamColor(teamId, color);
    },
    [teamId]
  );

  // Read inside reportPosition without re-creating it on every change.
  const recordingRef = useRef<string | null>(null);
  recordingRef.current = team?.recordingId ?? null;
  const profileRef = useRef({ callsign, role });
  profileRef.current = { callsign: callsign || 'Боец', role };

  // Throttled position publishing.
  const lastSent = useRef<{ at: number; pos: SelfPosition } | null>(null);
  const inFlight = useRef(false);

  const { reportSelf } = mesh;
  const reportPosition = useCallback(
    (p: SelfPosition) => {
      if (shareLocation) reportSelf(p);
      if (!teamId || !uid || !shareLocation || inFlight.current) return;
      const last = lastSent.current;
      const now = Date.now();
      if (last) {
        const elapsed = now - last.at;
        if (elapsed < MIN_INTERVAL_MS) return;
        if (elapsed < HEARTBEAT_MS && distanceMeters(last.pos, p) < MIN_MOVE_M) return;
      }
      inFlight.current = true;
      const recId = recordingRef.current;
      teams
        .publishPosition(teamId, uid, p)
        .then(() => {
          lastSent.current = { at: now, pos: p };
          if (recId) {
            recordings
              .appendTrackPoint(teamId, recId, uid, profileRef.current, { lat: p.lat, lng: p.lng, t: now })
              .catch(() => {});
          }
        })
        .catch(() => {})
        .finally(() => {
          inFlight.current = false;
        });
    },
    [teamId, uid, shareLocation, reportSelf]
  );

  useEffect(() => {
    lastSent.current = null;
  }, [teamId]);

  const setShareLocation = useCallback(
    async (v: boolean) => {
      setShareLocationState(v);
      await saveJson(KEYS.shareLocation, v);
      if (!v && teamId && uid) await teams.clearPosition(teamId, uid).catch(() => {});
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
    async (m: Pick<TacMarker, 'kind' | 'label' | 'lat' | 'lng' | 'points' | 'color'>, scope: MarkerScope) => {
      const base = { ...m, label: m.label.trim().slice(0, 40), createdByName: callsign || 'Я' };
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
    [teamId, uid, callsign, personalMarkers, savePersonal, sendMark, fireAndReport]
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

  const markers = useMemo(
    () =>
      inTeam
        ? [
            ...shownTeamMarkers.filter(
              (m) => (m.audience !== 'commanders' || canCommand) && !isVotedOut(m, members.length)
            ),
            ...personalMarkers,
          ]
        : personalMarkers,
    [inTeam, shownTeamMarkers, personalMarkers, canCommand, members.length]
  );

  // Waiting at the respawn: buzz a minute before the next departure and again when it
  // leaves, so a "dead" fighter doesn't have to stare at the countdown.
  const waveMarkers = useMemo(() => markers.filter((m) => m.wave), [markers]);
  useEffect(() => {
    if (status !== 'dead' || !waveMarkers.length) return;
    const fired = new Set<string>();
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
      teamColor: team?.color ?? DEFAULT_TEAM_COLOR,
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
      showGrid,
      setShowGrid,
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
      clearTeamMarkers,
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
      showGrid,
      setShowGrid,
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
      clearTeamMarkers,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
