import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  decodePosition,
  decodeTelemetryBattery,
  decodeUser,
  hasSquadChannel,
  packetId,
  payloadForMtu,
  PORT,
  sendPacket,
  setSquadChannel,
  SQUAD_CHANNEL,
  squadPsk,
} from '../lib/meshtastic';
import type { MtChannel, MtNode, MtPacket } from '../lib/meshtastic';
import { KEYS, loadJson, saveJson } from '../lib/storage';
import {
  bluetoothReady,
  RadioLink,
  radioSupported,
  requestRadioPermissions,
  scanRadios,
  type RadioDevice,
  type RadioState,
} from '../services/meshRadio';

/** Lost the radio: try again this often while it's still the chosen one. */
const RECONNECT_MS = 15_000;
const MAX_NODES = 100;

export type Radio = {
  /** This build can talk to radios (not Expo Go, not the web). */
  supported: boolean;
  /** The radio picked in settings (remembered), if any. */
  device: RadioDevice | null;
  state: RadioState;
  error: string | null;
  /** Our radio's node number. */
  myNode: number | null;
  /** The squad channel is set up on the radio (needed to send and receive GrimMap data). */
  squadReady: boolean;
  /** Slot SQUAD_CHANNEL holds something else that setting up would replace. */
  slotTaken: string | null;
  /** Other radios the mesh has heard, newest first. */
  nodes: MtNode[];
  scan: (onFound: (d: RadioDevice) => void) => Promise<() => void>;
  choose: (d: RadioDevice) => Promise<void>;
  forget: () => Promise<void>;
  setupSquadChannel: () => Promise<void>;
  /** Sends one payload on the squad channel. */
  send: (portnum: number, payload: Uint8Array) => Promise<void>;
  /** Largest payload per packet the connected radio's Bluetooth link takes in one write. */
  maxPayload: () => number;
  /** Our own radio's GPS position, if it has GPS (laptops have none of their own). */
  myPosition: { lat: number; lng: number; at: number } | null;
  /** Our own radio's battery %, 101 = on external power. */
  myBattery: number | null;
};

/** Connection to the user's Meshtastic radio; packets go to `onPacket`. */
export function useRadio(teamId: string | null, onPacket: (p: MtPacket) => void): Radio {
  const [device, setDevice] = useState<RadioDevice | null>(null);
  const [state, setState] = useState<RadioState>('off');
  const [error, setError] = useState<string | null>(null);
  const [myNode, setMyNode] = useState<number | null>(null);
  const [channels, setChannels] = useState<MtChannel[]>([]);
  const [nodes, setNodes] = useState<Map<number, MtNode>>(new Map());
  const link = useRef<RadioLink | null>(null);
  const onPacketRef = useRef(onPacket);
  onPacketRef.current = onPacket;
  const myNodeRef = useRef<number | null>(null);
  const [myPosition, setMyPosition] = useState<{ lat: number; lng: number; at: number } | null>(null);
  const [myBattery, setMyBattery] = useState<number | null>(null);

  const updateNode = useCallback((num: number, patch: Partial<MtNode>) => {
    setNodes((cur) => {
      const prev = cur.get(num) ?? { num, longName: '', shortName: '', lat: null, lng: null, lastHeard: 0 };
      const next = new Map(cur);
      next.set(num, {
        ...prev,
        ...(patch.longName ? { longName: patch.longName, shortName: patch.shortName ?? prev.shortName } : {}),
        ...(patch.lat != null && patch.lng != null ? { lat: patch.lat, lng: patch.lng } : {}),
        lastHeard: Math.max(prev.lastHeard, patch.lastHeard ?? 0),
      });
      if (next.size > MAX_NODES) {
        const oldest = [...next.values()].sort((a, b) => a.lastHeard - b.lastHeard)[0];
        next.delete(oldest.num);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!radioSupported) return;
    loadJson<RadioDevice | null>(KEYS.radio, null).then((d) => d && setDevice(d));
  }, []);

  // Keep a link to the chosen radio, reconnecting when it drops.
  useEffect(() => {
    if (!radioSupported || !device) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const later = () => {
      if (!stopped && !retry) retry = setTimeout(connect, RECONNECT_MS);
    };

    const connect = async () => {
      retry = null;
      if (stopped) return;
      if (!(await requestRadioPermissions()) || !(await bluetoothReady())) {
        setError('Включите Bluetooth и разрешите GrimMap доступ к нему');
        later();
        return;
      }
      const l = new RadioLink(device.id, {
        onState: (s, err) => {
          if (stopped) return;
          setState(s);
          if (err) setError(err);
          if (s === 'ready') setError(null);
          if (s === 'off') {
            if (link.current === l) link.current = null;
            l.close().catch(() => {});
            later();
          }
        },
        onMyNode: (n) => {
          myNodeRef.current = n;
          setMyNode(n);
        },
        onChannels: setChannels,
        onNode: (n) => {
          if (n.num !== myNodeRef.current) updateNode(n.num, n);
          else {
            if (n.lat != null && n.lng != null) setMyPosition({ lat: n.lat, lng: n.lng, at: Date.now() });
            if (n.battery != null) setMyBattery(n.battery);
          }
        },
        onPacket: (p) => {
          if (p.from === myNodeRef.current) {
            // Our radio's own telemetry: its battery.
            if (p.portnum === PORT.telemetry) {
              try {
                const b = decodeTelemetryBattery(p.payload);
                if (b != null) setMyBattery(b);
              } catch {
                // Other telemetry.
              }
            }
            // Our radio's own position broadcast: its GPS fix.
            if (p.portnum === PORT.position) {
              try {
                const pos = decodePosition(p.payload);
                if (pos) setMyPosition({ ...pos, at: Date.now() });
              } catch {
                // Not a position after all.
              }
            }
            return;
          }
          // Radios announce names and (with GPS) positions; keep the list current.
          const heard = p.rxTime || Math.floor(Date.now() / 1000);
          try {
            if (p.portnum === PORT.position) updateNode(p.from, { ...decodePosition(p.payload), lastHeard: heard });
            else if (p.portnum === PORT.nodeInfo) updateNode(p.from, { ...decodeUser(p.payload), lastHeard: heard });
            else updateNode(p.from, { lastHeard: heard });
          } catch {
            // Malformed announcement from some radio: ignore.
          }
          onPacketRef.current(p);
        },
      });
      link.current = l;
      try {
        await l.open();
      } catch (e) {
        if (stopped) return;
        if (link.current === l) link.current = null;
        setState('off');
        setError((e as Error).message);
        l.close().catch(() => {});
        later();
      }
    };
    connect();

    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      link.current?.close().catch(() => {});
      link.current = null;
      setState('off');
      setChannels([]);
    };
  }, [device, updateNode]);

  const psk = useMemo(() => (teamId ? squadPsk(teamId) : null), [teamId]);
  const squadReady = state === 'ready' && psk != null && hasSquadChannel(channels, psk);
  const slot = channels.find((c) => c.index === SQUAD_CHANNEL);
  const slotTaken = slot && slot.role !== 0 && !squadReady ? slot.name || `канал ${SQUAD_CHANNEL}` : null;

  // A free slot is set up without asking; a taken one waits for the user (settings).
  const autoTried = useRef<string | null>(null);
  useEffect(() => {
    if (state !== 'ready' || !psk || squadReady || slotTaken || myNode == null || !link.current) return;
    const key = `${device?.id}:${teamId}`;
    if (autoTried.current === key) return;
    autoTried.current = key;
    const l = link.current;
    l.write(setSquadChannel(myNode, psk, packetId()))
      .then(() => l.requestConfig())
      .catch((e: Error) => setError(e.message));
  }, [state, psk, squadReady, slotTaken, myNode, device, teamId]);

  const scan = useCallback(async (onFound: (d: RadioDevice) => void) => {
    setError(null);
    if (!(await requestRadioPermissions())) {
      setError('Нет разрешения на Bluetooth');
      return () => {};
    }
    if (!(await bluetoothReady())) {
      setError('Включите Bluetooth');
      return () => {};
    }
    return scanRadios(onFound, setError);
  }, []);

  const choose = useCallback(async (d: RadioDevice) => {
    setNodes(new Map());
    setDevice(d);
    await saveJson(KEYS.radio, d);
  }, []);

  const forget = useCallback(async () => {
    setDevice(null);
    setNodes(new Map());
    setError(null);
    await saveJson(KEYS.radio, null);
  }, []);

  const setupSquadChannel = useCallback(async () => {
    const l = link.current;
    if (!l || !psk || myNode == null) throw new Error('Рация не подключена');
    await l.write(setSquadChannel(myNode, psk, packetId()));
    await l.requestConfig();
  }, [psk, myNode]);

  const send = useCallback(
    async (portnum: number, payload: Uint8Array) => {
      const l = link.current;
      if (!l || !squadReady) return;
      await l.write(sendPacket({ channel: SQUAD_CHANNEL, portnum, payload, id: packetId() }));
    },
    [squadReady]
  );

  const maxPayload = useCallback(() => link.current?.maxPayload ?? payloadForMtu(null), []);

  const nodeList = useMemo(() => [...nodes.values()].sort((a, b) => b.lastHeard - a.lastHeard), [nodes]);

  return {
    supported: radioSupported,
    device,
    state,
    error,
    myNode,
    squadReady,
    slotTaken,
    nodes: nodeList,
    scan,
    choose,
    forget,
    setupSquadChannel,
    send,
    maxPayload,
    myPosition,
    myBattery,
  };
}
