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
import { KEYS, loadJson, newId, saveJson } from '../lib/storage';
import type { Member, SelfPosition, TacMarker, Team } from '../lib/types';
import { distanceMeters } from '../lib/geo';
import * as teams from '../services/teams';

/** Re-send position at least this often so teammates can tell we're alive. */
const HEARTBEAT_MS = 30_000;
const MIN_INTERVAL_MS = 4_000;
const MIN_MOVE_M = 3;

type Session = {
  ready: boolean;
  firebaseEnabled: boolean;
  uid: string | null;
  authError: string | null;
  callsign: string;
  setCallsign: (c: string) => Promise<void>;

  teamId: string | null;
  team: Team | null;
  members: Member[];
  teamError: string | null;
  createTeam: (name: string) => Promise<void>;
  joinTeam: (code: string) => Promise<void>;
  leaveTeam: () => Promise<void>;
  kickMember: (memberId: string) => Promise<void>;

  shareLocation: boolean;
  setShareLocation: (v: boolean) => Promise<void>;
  reportPosition: (p: SelfPosition) => void;

  markers: TacMarker[];
  addMarker: (m: Pick<TacMarker, 'kind' | 'label' | 'lat' | 'lng'>) => Promise<void>;
  deleteMarker: (id: string) => Promise<void>;
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
  const [teamId, setTeamId] = useState<string | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [shareLocation, setShareLocationState] = useState(true);
  const [teamMarkers, setTeamMarkers] = useState<TacMarker[]>([]);
  const [soloMarkers, setSoloMarkers] = useState<TacMarker[]>([]);

  // Load persisted local state.
  useEffect(() => {
    (async () => {
      const [cs, tid, share, solo] = await Promise.all([
        loadJson<string>(KEYS.callsign, ''),
        loadJson<string | null>(KEYS.teamId, null),
        loadJson<boolean>(KEYS.shareLocation, true),
        loadJson<TacMarker[]>(KEYS.soloMarkers, []),
      ]);
      setCallsignState(cs);
      setTeamId(tid);
      setShareLocationState(share);
      setSoloMarkers(solo);
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

  // Live team subscriptions.
  useEffect(() => {
    if (!teamId || !uid) {
      setTeam(null);
      setMembers([]);
      setTeamMarkers([]);
      return;
    }
    setTeamError(null);
    const onError = (e: Error) => setTeamError(e.message);
    const unsubs = [
      teams.subscribeTeam(teamId, setTeam, onError),
      teams.subscribeMembers(
        teamId,
        (list) => {
          setMembers(list);
          // Kicked or left from another device.
          if (!list.some((m) => m.id === uid)) {
            setTeamError('Вы больше не состоите в этой команде');
          }
        },
        onError
      ),
      teams.subscribeTeamMarkers(teamId, setTeamMarkers, onError),
    ];
    return () => unsubs.forEach((u) => u());
  }, [teamId, uid]);

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
      if (teamId && uid && v) await teams.updateCallsign(teamId, uid, v);
    },
    [teamId, uid]
  );

  const createTeam = useCallback(
    async (name: string) => {
      const id = await teams.createTeam(requireUid(), requireCallsign(), name.trim() || 'Команда');
      await persistTeamId(id);
    },
    [requireUid, requireCallsign, persistTeamId]
  );

  const joinTeam = useCallback(
    async (code: string) => {
      const id = await teams.joinTeam(requireUid(), requireCallsign(), code);
      await persistTeamId(id);
    },
    [requireUid, requireCallsign, persistTeamId]
  );

  const leaveTeam = useCallback(async () => {
    if (teamId && uid) {
      try {
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

  // Markers: shared with the team when in one, otherwise stored on the device.
  const addMarker = useCallback(
    async (m: Pick<TacMarker, 'kind' | 'label' | 'lat' | 'lng'>) => {
      const base = { ...m, label: m.label.trim().slice(0, 40), createdByName: callsign || 'Я' };
      if (teamId && uid) {
        await teams.addTeamMarker(teamId, { ...base, createdBy: uid });
      } else {
        const next = [...soloMarkers, { ...base, id: newId(), createdBy: 'local', createdAt: Date.now() }];
        setSoloMarkers(next);
        await saveJson(KEYS.soloMarkers, next);
      }
    },
    [teamId, uid, callsign, soloMarkers]
  );

  const deleteMarker = useCallback(
    async (id: string) => {
      if (teamId && uid) {
        await teams.deleteTeamMarker(teamId, id);
      } else {
        const next = soloMarkers.filter((m) => m.id !== id);
        setSoloMarkers(next);
        await saveJson(KEYS.soloMarkers, next);
      }
    },
    [teamId, uid, soloMarkers]
  );

  const value = useMemo<Session>(
    () => ({
      ready,
      firebaseEnabled: isFirebaseConfigured,
      uid,
      authError,
      callsign,
      setCallsign,
      teamId,
      team,
      members,
      teamError,
      createTeam,
      joinTeam,
      leaveTeam,
      kickMember,
      shareLocation,
      setShareLocation,
      reportPosition,
      markers: teamId && uid ? teamMarkers : soloMarkers,
      addMarker,
      deleteMarker,
    }),
    [
      ready,
      uid,
      authError,
      callsign,
      setCallsign,
      teamId,
      team,
      members,
      teamError,
      createTeam,
      joinTeam,
      leaveTeam,
      kickMember,
      shareLocation,
      setShareLocation,
      reportPosition,
      teamMarkers,
      soloMarkers,
      addMarker,
      deleteMarker,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
