import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

import { GrimMesh } from '../../modules/grim-mesh';
import { distanceMeters } from '../lib/geo';
import { decodeEnvelope, encodeEnvelope, fragment, RadioOutbox, radioPosIntervals, Reassembler } from '../lib/lora';
import { PORT, SQUAD_CHANNEL, type MtPacket } from '../lib/meshtastic';
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
import { checkSafeMode } from '../services/crashGuard';
import type { MemberStatus, SelfPosition, TacMarker } from '../lib/types';

import { useRadio, type Radio } from './useRadio';

/** Own position goes out at most this often, or when moved this far. */
const POS_MIN_MS = 4_000;
const POS_HEARTBEAT_MS = 20_000;
const POS_MIN_MOVE_M = 3;
/** Found but not connected: try again this often. */
const REDIAL_MS = 15_000;
/**
 * Over the radio (LoRa airtime is scarce): own position when moved this far; how often
 * depends on how many squad radios share the air (`radioPosIntervals` in lora.ts).
 */
const RADIO_POS_MIN_MOVE_M = 15;
/** Squad radios heard this recently count toward the air's load. */
const RADIO_PEER_WINDOW_MS = 10 * 60_000;
const RADIO_TICK_MS = 500;

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
  /** Meshtastic radio link (LoRa), alongside the phone-to-phone mesh. */
  radio: Radio;
  /** Squadmates heard over the radio in the last 10 minutes. */
  radioPeers: number;
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
  /** Nearby endpoints linked right now (shared with the radio side for relaying). */
  const nearbyPeers = useRef(new Set<string>());
  const nearbyOnRef = useRef(false);

  // Radio side: fragments in, packets out at the pace the air allows.
  const reassembler = useRef(new Reassembler());
  const outbox = useRef(new RadioOutbox());
  const radioRelayed = useRef(new Map<string, number>());
  const radioHeard = useRef(new Map<string, number>());
  const lastRadioSelf = useRef<{ at: number; p: SelfPosition; status: MemberStatus } | null>(null);
  const onRadioPacket = useRef<(p: MtPacket) => void>(() => {});
  const radio = useRadio(teamId, (p) => onRadioPacket.current(p));
  const radioOn = Boolean(radio.squadReady && teamId && uid);
  const radioOnRef = useRef(false);
  radioOnRef.current = radioOn;

  useEffect(() => {
    (async () => {
      const on = await loadJson<boolean>(KEYS.mesh, false);
      // After repeated startup crashes the mesh stays off until switched on by hand.
      if (on && (await checkSafeMode())) {
        await saveJson(KEYS.mesh, false);
        return;
      }
      setEnabledState(on);
    })();
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
    if (!GrimMesh || !list.length || !nearbyOnRef.current) return;
    for (const packet of pack(list)) GrimMesh.send(to, packet).catch(() => {});
  }, []);

  /** Pace of positions on the air for the radio net as it is now (me included). */
  const radioPace = useCallback(() => {
    const now = Date.now();
    let n = 1;
    for (const at of radioHeard.current.values()) if (now - at < RADIO_PEER_WINDOW_MS) n++;
    return radioPosIntervals(n);
  }, []);

  /** Queues envelopes for the air; `own` ones always, relayed positions sparingly. */
  const toRadio = useCallback(
    (list: Envelope[], own: boolean) => {
      if (!radioOnRef.current || !teamId) return;
      const now = Date.now();
      for (const e of list) {
        if (!own && e.kind === 'pos') {
          const last = radioRelayed.current.get(e.body.uid) ?? 0;
          if (now - last < radioPace().relayMs) continue;
          radioRelayed.current.set(e.body.uid, now);
        }
        const frames = fragment(encodeEnvelope(e, teamId), Math.floor(Math.random() * 0xffff), radio.maxPayload());
        if (frames) outbox.current.push(e, frames);
      }
    },
    [teamId, radioPace, radio.maxPayload]
  );

  const nearbyOn = Boolean(enabled && available && teamId && uid);
  nearbyOnRef.current = nearbyOn;
  const running = nearbyOn || radioOn;

  // Radio in: reassemble, decode, keep what's new and pass it on to nearby phones.
  onRadioPacket.current = (p: MtPacket) => {
    if (!teamId || !uid || p.channel !== SQUAD_CHANNEL || p.portnum !== PORT.private) return;
    const now = Date.now();
    const whole = reassembler.current.push(p.from, p.payload, now);
    const env = whole && decodeEnvelope(whole, teamId);
    if (!env) return;
    const sender = env.kind === 'mark' ? env.body.createdBy : env.body.uid;
    if (sender !== uid) radioHeard.current.set(sender, now);
    const knownMark = env.kind === 'mark' && store.marks.has(env.body.id);
    if (!store.accept(env, now)) return;
    if (env.kind === 'mark' && !env.body.deleted && !knownMark && env.body.createdBy !== uid) {
      meRef.current.onNewMark?.(env.body);
    }
    setVersion((v) => v + 1);
    if (nearbyPeers.current.size) broadcast([forwarded(env)], [...nearbyPeers.current]);
  };

  // Radio out: one packet at a time.
  const { send: radioSend } = radio;
  useEffect(() => {
    if (!radioOn) {
      outbox.current.clear();
      return;
    }
    const t = setInterval(() => {
      const frame = outbox.current.next(Date.now());
      if (frame) radioSend(PORT.private, frame).catch(() => {});
    }, RADIO_TICK_MS);
    return () => clearInterval(t);
  }, [radioOn, radioSend]);

  useEffect(() => {
    if (!nearbyOn || !GrimMesh || !teamId || !uid) return;
    const mesh = GrimMesh;
    const myName = endpointName(teamId, uid, meRef.current.callsign || 'Боец');
    const tag = `${squadTag(teamId)}|`;
    const found = new Map<string, { name: string; since: number }>();
    const connected = nearbyPeers.current;
    connected.clear();
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
        // Pass the news on to everyone else, and to the radio net.
        const others = [...connected].filter((id) => id !== e.from);
        if (others.length) broadcast(fresh.map(forwarded), others);
        toRadio(fresh, false);
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
    // Not during app startup: let the UI come up first.
    const starter = setTimeout(() => {
      try {
        mesh.start(MESH_SERVICE_ID, myName, tag).catch((err: Error) => setError(err.message));
      } catch (err) {
        setError((err as Error).message);
      }
    }, 3000);

    return () => {
      alive = false;
      clearTimeout(starter);
      clearInterval(timer);
      subs.forEach((s) => s.remove());
      mesh.stop().catch(() => {});
      connected.clear();
      setPeers(0);
    };
  }, [nearbyOn, teamId, uid, store, broadcast, toRadio]);

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
      if (!store.accept(env, now)) return;
      broadcast([env]);
      // The air gets far fewer updates: on a real move, a status change, or a heartbeat.
      const lr = lastRadioSelf.current;
      const pace = radioPace();
      const due =
        !lr ||
        lr.status !== m.status ||
        now - lr.at >= pace.heartbeatMs ||
        (now - lr.at >= pace.minMs && distanceMeters(lr.p, p) >= RADIO_POS_MIN_MOVE_M);
      if (due && radioOnRef.current) {
        lastRadioSelf.current = { at: now, p, status: m.status };
        toRadio([env], true);
      }
    },
    [store, broadcast, toRadio, radioPace]
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
        toRadio([env], true);
      }
    },
    [running, teamId, store, broadcast, toRadio]
  );

  const sendMark = useCallback(
    (m: TacMarker, deleted = false) => {
      if (!running || !teamId || m.personal) return;
      const now = Date.now();
      const env = markEnvelope(teamId, toMeshMark(m, deleted), now);
      if (store.accept(env, now)) {
        setVersion((v) => v + 1);
        broadcast([env]);
        toRadio([env], true);
      }
    },
    [running, teamId, store, broadcast, toRadio]
  );

  const sendVote = useCallback(
    (v: MeshVote) => {
      if (!running || !teamId) return;
      const now = Date.now();
      const env = voteEnvelope(teamId, v, now);
      if (store.accept(env, now)) {
        setVersion((x) => x + 1);
        broadcast([env]);
        toRadio([env], true);
      }
    },
    [running, teamId, store, broadcast, toRadio]
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

  const radioPeers = useMemo(() => {
    const now = Date.now();
    let n = 0;
    for (const at of radioHeard.current.values()) if (now - at < RADIO_PEER_WINDOW_MS) n++;
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  return {
    radio,
    radioPeers,
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
