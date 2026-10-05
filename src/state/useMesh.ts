import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

import { GrimMesh } from '../../modules/grim-mesh';
import { distanceMeters } from '../lib/geo';
import {
  chatEnvelope,
  endpointName,
  forwarded,
  markEnvelope,
  MESH_SERVICE_ID,
  MeshStore,
  pack,
  posEnvelope,
  shouldDial,
  squadTag,
  toMeshMark,
  unpack,
  voteEnvelope,
  type Envelope,
  type MeshChat,
  type MeshMark,
  type MeshVote,
} from '../lib/mesh';
import type { RoleId } from '../lib/roles';
import { KEYS, loadJson, saveJson } from '../lib/storage';
import type { MemberStatus, SelfPosition, TacMarker } from '../lib/types';

/** Own position goes out at most this often, or when moved this far. */
const POS_MIN_MS = 4_000;
const POS_HEARTBEAT_MS = 20_000;
const POS_MIN_MOVE_M = 3;
/** Found but not connected: try again this often. */
const REDIAL_MS = 15_000;

export type Mesh = {
  /** The native module is in this build (Android). */
  available: boolean;
  enabled: boolean;
  setEnabled: (v: boolean) => Promise<void>;
  /** Phones connected right now. */
  peers: number;
  error: string | null;
  /** Freshest known position of each fighter, as heard over the mesh. */
  positions: (Envelope & { kind: 'pos' })[];
  /** Chat heard over the mesh. */
  chats: (MeshChat & { t: number })[];
  sendChat: (c: MeshChat) => void;
  /** Markers created, moved or deleted (tombstones), as heard over the mesh. */
  marks: (Envelope & { kind: 'mark' })[];
  votes: (Envelope & { kind: 'vote' })[];
  /** Tells nearby phones about a new, moved or deleted squad marker. */
  sendMark: (m: TacMarker, deleted?: boolean) => void;
  sendVote: (v: MeshVote) => void;
  reportSelf: (p: SelfPosition) => void;
};

async function requestPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const P = PermissionsAndroid.PERMISSIONS;
  const api = typeof Platform.Version === 'number' ? Platform.Version : 0;
  const wanted = [P.ACCESS_FINE_LOCATION];
  if (api >= 31) wanted.push(P.BLUETOOTH_SCAN, P.BLUETOOTH_ADVERTISE, P.BLUETOOTH_CONNECT);
  if (api >= 33) wanted.push(P.NEARBY_WIFI_DEVICES);
  const res = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED);
}

/**
 * Bluetooth / Wi-Fi Direct link between phones of one squad, for when there's no
 * internet. Positions and chat hop phone to phone (see src/lib/mesh.ts).
 */
export function useMesh(me: {
  teamId: string | null;
  uid: string | null;
  callsign: string;
  role: RoleId;
  status: MemberStatus;
  canCommand: boolean;
  /** A marker someone else created reached us over the mesh for the first time. */
  onNewMark?: (m: MeshMark) => void;
}): Mesh {
  const available = GrimMesh != null;
  const [enabled, setEnabledState] = useState(false);
  const [peers, setPeers] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const { teamId, uid } = me;
  const store = useMemo(() => new MeshStore(teamId ?? ''), [teamId]);
  const meRef = useRef(me);
  meRef.current = me;
  const lastSelf = useRef<{ at: number; p: SelfPosition } | null>(null);

  useEffect(() => {
    loadJson<boolean>(KEYS.mesh, false).then(setEnabledState);
  }, []);

  const setEnabled = useCallback(async (v: boolean) => {
    if (v && !(await requestPermissions())) {
      setError('Нет разрешений на Bluetooth и «Устройства поблизости»');
      return;
    }
    setError(null);
    setEnabledState(v);
    await saveJson(KEYS.mesh, v);
  }, []);

  const broadcast = useCallback((list: Envelope[], to: string[] = []) => {
    if (!GrimMesh || !list.length) return;
    for (const packet of pack(list)) GrimMesh.send(to, packet).catch(() => {});
  }, []);

  const running = Boolean(enabled && available && teamId && uid);

  useEffect(() => {
    if (!running || !GrimMesh || !teamId || !uid) return;
    const mesh = GrimMesh;
    const myName = endpointName(teamId, uid, meRef.current.callsign || 'Боец');
    const tag = `${squadTag(teamId)}|`;
    const found = new Map<string, { name: string; since: number }>();
    const connected = new Set<string>();
    let alive = true;

    const subs = [
      mesh.addListener('onPeer', (e) => {
        if (e.state === 'found' && e.name?.startsWith(tag)) {
          found.set(e.id, { name: e.name, since: Date.now() });
          if (shouldDial(myName, e.name)) mesh.connect(e.id).catch(() => {});
        } else if (e.state === 'lost') {
          found.delete(e.id);
        } else if (e.state === 'connected') {
          connected.add(e.id);
          setPeers(connected.size);
          // Hand over everything we know.
          broadcast(store.snapshot(Date.now()), [e.id]);
        } else if (e.state === 'disconnected' || e.state === 'failed') {
          connected.delete(e.id);
          setPeers(connected.size);
        }
      }),
      mesh.addListener('onMessage', (e) => {
        const now = Date.now();
        const knownMarks = new Set(store.marks.keys());
        const fresh = unpack(e.data).filter((env) => store.accept(env, now));
        if (!fresh.length) return;
        for (const env of fresh) {
          if (env.kind === 'mark' && !env.body.deleted && !knownMarks.has(env.body.id) && env.body.createdBy !== uid) {
            meRef.current.onNewMark?.(env.body);
          }
        }
        setVersion((v) => v + 1);
        // Pass the news on to everyone else.
        const others = [...connected].filter((id) => id !== e.from);
        if (others.length) broadcast(fresh.map(forwarded), others);
      }),
      mesh.addListener('onError', (e) => {
        if (alive) setError(`${e.where}: ${e.message}`);
      }),
    ];

    // Re-dial phones we see but aren't linked to; after a while, whichever side.
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [id, f] of found) {
        if (connected.has(id)) continue;
        if (shouldDial(myName, f.name) || now - f.since > REDIAL_MS * 2) mesh.connect(id).catch(() => {});
      }
      store.prune(now);
    }, REDIAL_MS);

    setError(null);
    mesh.start(MESH_SERVICE_ID, myName, tag).catch((err: Error) => setError(err.message));

    return () => {
      alive = false;
      clearInterval(timer);
      subs.forEach((s) => s.remove());
      mesh.stop().catch(() => {});
      setPeers(0);
    };
  }, [running, teamId, uid, store, broadcast]);

  const sendSelf = useCallback(
    (p: SelfPosition, now: number) => {
      const m = meRef.current;
      if (!m.teamId || !m.uid) return;
      lastSelf.current = { at: now, p };
      const env = posEnvelope(
        m.teamId,
        {
          uid: m.uid,
          callsign: (m.callsign || 'Боец').slice(0, 24),
          role: m.role,
          status: m.status,
          cmd: m.canCommand,
          lat: p.lat,
          lng: p.lng,
          heading: p.heading,
          accuracy: p.accuracy,
        },
        now
      );
      if (store.accept(env, now)) broadcast([env]);
    },
    [store, broadcast]
  );

  const reportSelf = useCallback(
    (p: SelfPosition) => {
      if (!running) return;
      const now = Date.now();
      const last = lastSelf.current;
      if (last) {
        const elapsed = now - last.at;
        if (elapsed < POS_MIN_MS) return;
        if (elapsed < POS_HEARTBEAT_MS && distanceMeters(last.p, p) < POS_MIN_MOVE_M) return;
      }
      sendSelf(p, now);
    },
    [running, sendSelf]
  );

  // A status change (killed, back in the game) goes out right away.
  useEffect(() => {
    if (running && lastSelf.current) sendSelf(lastSelf.current.p, Date.now());
  }, [me.status, running, sendSelf]);

  const sendChat = useCallback(
    (c: MeshChat) => {
      if (!running || !teamId) return;
      const now = Date.now();
      const env = chatEnvelope(teamId, c, now);
      if (store.accept(env, now)) {
        setVersion((v) => v + 1);
        broadcast([env]);
      }
    },
    [running, teamId, store, broadcast]
  );

  const sendMark = useCallback(
    (m: TacMarker, deleted = false) => {
      if (!running || !teamId || m.personal) return;
      const now = Date.now();
      const env = markEnvelope(teamId, toMeshMark(m, deleted), now);
      if (store.accept(env, now)) {
        setVersion((v) => v + 1);
        broadcast([env]);
      }
    },
    [running, teamId, store, broadcast]
  );

  const sendVote = useCallback(
    (v: MeshVote) => {
      if (!running || !teamId) return;
      const now = Date.now();
      const env = voteEnvelope(teamId, v, now);
      if (store.accept(env, now)) {
        setVersion((x) => x + 1);
        broadcast([env]);
      }
    },
    [running, teamId, store, broadcast]
  );

  const marks = useMemo(
    () => (running ? [...store.marks.values()] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [running, store, version]
  );
  const votes = useMemo(
    () => (running ? [...store.votes.values()] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [running, store, version]
  );

  const positions = useMemo(
    () => (running ? [...store.positions.values()] : []),
    // `version` bumps whenever the store takes news.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [running, store, version]
  );
  const chats = useMemo(
    () => (running ? [...store.chats.values()].map((e) => ({ ...e.body, t: e.t })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [running, store, version]
  );

  return {
    available,
    enabled,
    setEnabled,
    peers,
    error,
    positions,
    chats,
    sendChat,
    marks,
    votes,
    sendMark,
    sendVote,
    reportSelf,
  };
}
