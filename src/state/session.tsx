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
import { isOrder } from '../lib/markerKinds';
import { DEFAULT_ROLE, DEFAULT_TEAM_COLOR, roleOf, type RoleId } from '../lib/roles';
import { KEYS, loadJson, newId, saveJson } from '../lib/storage';
import type { Member, SelfPosition, TacMarker, Team } from '../lib/types';
import { signalNewOrder } from '../services/orderAlert';
import * as teams from '../services/teams';

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

  /** Team markers (when in a team) plus this device's personal ones. */
  markers: TacMarker[];
  addMarker: (m: Pick<TacMarker, 'kind' | 'label' | 'lat' | 'lng'>, scope: MarkerScope) => Promise<void>;
  deleteMarker: (m: TacMarker) => Promise<void>;
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
  const [teamMarkers, setTeamMarkers] = useState<TacMarker[]>([]);
  const [personalMarkers, setPersonalMarkers] = useState<TacMarker[]>([]);

  // Load persisted local state.
  useEffect(() => {
    (async () => {
      const [cs, r, av, tid, share, sound, personal] = await Promise.all([
        loadJson<string>(KEYS.callsign, ''),
        loadJson<string>(KEYS.role, DEFAULT_ROLE),
        loadJson<string | null>(KEYS.avatar, null),
        loadJson<string | null>(KEYS.teamId, null),
        loadJson<boolean>(KEYS.shareLocation, true),
        loadJson<boolean>(KEYS.orderSound, true),
        loadJson<TacMarker[]>(KEYS.personalMarkers, []),
      ]);
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
            if (fresh.length) signalNewOrder(orderSoundRef.current);
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
      if (teamId && uid && v) await teams.updateProfile(teamId, uid, { callsign: v });
    },
    [teamId, uid]
  );

  const setRole = useCallback(
    async (r: RoleId) => {
      setRoleState(r);
      await saveJson(KEYS.role, r);
      if (teamId && uid) await teams.updateProfile(teamId, uid, { role: r });
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

  const setTeamColor = useCallback(
    async (color: string) => {
      if (teamId) await teams.setTeamColor(teamId, color);
    },
    [teamId]
  );

  // Throttled position publishing.
  const lastSent = useRef<{ at: number; pos: SelfPosition } | null>(null);
  const inFlight = useRef(false);

  const reportPosition = useCallback(
    (p: SelfPosition) => {
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
    [teamId, uid, shareLocation]
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

  const addMarker = useCallback(
    async (m: Pick<TacMarker, 'kind' | 'label' | 'lat' | 'lng'>, scope: MarkerScope) => {
      const base = { ...m, label: m.label.trim().slice(0, 40), createdByName: callsign || 'Я' };
      if (scope === 'team' && teamId && uid) {
        await teams.addTeamMarker(teamId, { ...base, createdBy: uid });
      } else {
        await savePersonal([
          ...personalMarkers,
          { ...base, id: newId(), createdBy: 'local', createdAt: Date.now(), personal: true },
        ]);
      }
    },
    [teamId, uid, callsign, personalMarkers, savePersonal]
  );

  const deleteMarker = useCallback(
    async (m: TacMarker) => {
      if (m.personal) await savePersonal(personalMarkers.filter((x) => x.id !== m.id));
      else if (teamId) await teams.deleteTeamMarker(teamId, m.id);
    },
    [teamId, personalMarkers, savePersonal]
  );

  const markers = useMemo(
    () =>
      inTeam
        ? [...teamMarkers.filter((m) => m.audience !== 'commanders' || canCommand), ...personalMarkers]
        : personalMarkers,
    [inTeam, teamMarkers, personalMarkers, canCommand]
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
      teamColor: team?.color ?? DEFAULT_TEAM_COLOR,
      members,
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
      markers,
      addMarker,
      deleteMarker,
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
      members,
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
      markers,
      addMarker,
      deleteMarker,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
