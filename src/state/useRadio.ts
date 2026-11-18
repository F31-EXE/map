import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  decodePosition,
  decodeTelemetryBattery,
  decodeUser,
  FAST_GPS_SECS,
  hasSquadChannel,
  LOC_MANUAL,
  patchVarints,
  POS_FLAG_DOP,
  POS_FLAG_SATS,
  radioAccuracy,
  radioGpsFast,
  radioHasGps,
  setPositionConfig,
  packetId,
  payloadForMtu,
  PORT,
  sendPacket,
  setSquadChannel,
  SQUAD_CHANNEL,
  squadPsk,
} from '../lib/meshtastic';
import type { MtChannel, MtNode, MtPacket, MtPosition, MtPositionConfig } from '../lib/meshtastic';
import { radioPollMs } from '../lib/gpsSource';
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

import { useGpsMode } from './gpsSource';

/** Lost the radio: try again this often while it's still the chosen one. */
const RECONNECT_MS = 15_000;
const MAX_NODES = 100;
/** The radio's DOP (from its own position broadcasts) is trusted this long. */
const DOP_MAX_AGE_MS = 15 * 60_000;

/** Our radio's GPS fix; `at` = when this phone saw it change. */
export type RadioGpsFix = { lat: number; lng: number; at: number; accuracy: number | null; sats: number | null };

export type RadioGps = {
  /** The radio's position settings (null until the config arrives). */
  config: MtPositionConfig | null;
  /** Has a GPS that's on; null = not known yet. */
  hasGps: boolean | null;
  /** Updates every few seconds and reports its precision (set up by «Ускорить GPS рации»). */
  fast: boolean;
  /** The phone is reading the radio's position now; how often. */
  pollMs: number | null;
  /** GrimMap changed this radio's GPS settings and can put them back. */
  canRestore: boolean;
};

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
  myPosition: RadioGpsFix | null;
  gps: RadioGps;
  /** GPS every FAST_GPS_SECS s with DOP and satellites in its reports; the radio reboots. */
  speedUpGps: () => Promise<void>;
  /** Puts back the GPS settings the radio had before speedUpGps; the radio reboots. */
  restoreGps: () => Promise<void>;
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
  const [myPosition, setMyPosition] = useState<RadioGpsFix | null>(null);
  const [posConfig, setPosConfig] = useState<MtPositionConfig | null>(null);
  const [backup, setBackup] = useState<{ device: string; interval: number; flags: number } | null>(null);
  // Precision from the radio's own position broadcasts (the node list has none).
  const dop = useRef<{ accuracy: number | null; sats: number | null; at: number } | null>(null);
  const lastFixKey = useRef<string | null>(null);
  const polledNodes = useRef(0);
  const gpsMode = useGpsMode();

  /** A position of our own radio: new fix → `at` now; the same fix again keeps its age. */
  const ownFix = useCallback((pos: MtPosition) => {
    if (pos.source === LOC_MANUAL) return;
    const key = pos.time ? String(pos.time) : `${pos.lat},${pos.lng}`;
    const d = dop.current && Date.now() - dop.current.at < DOP_MAX_AGE_MS ? dop.current : null;
    setMyPosition((prev) => {
      const same = lastFixKey.current === key && prev != null;
      lastFixKey.current = key;
      return {
        lat: pos.lat,
        lng: pos.lng,
        at: same ? prev.at : Date.now(),
        accuracy: d?.accuracy ?? null,
        sats: d?.sats ?? null,
      };
    });
  }, []);
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
        onPositionConfig: setPosConfig,
        onNodesPolled: (count) => {
          polledNodes.current = count;
        },
        onNode: (n) => {
          if (n.num !== myNodeRef.current) updateNode(n.num, n);
          else {
            if (n.pos) ownFix(n.pos);
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
                if (pos) {
                  if (pos.hdop || pos.pdop || pos.sats) {
                    dop.current = { accuracy: radioAccuracy(pos), sats: pos.sats || null, at: Date.now() };
                  }
                  ownFix(pos);
                }
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
      setPosConfig(null);
      setMyPosition(null);
      lastFixKey.current = null;
    };
  }, [device, updateNode, ownFix]);

  useEffect(() => {
    loadJson<{ device: string; interval: number; flags: number } | null>(KEYS.radioGpsBackup, null).then(setBackup);
  }, []);

  // «Авто» / «Рация»: read the radio's own position from its node list every few seconds.
  const hasGps = radioHasGps(posConfig);
  const polling = gpsMode !== 'phone' && state === 'ready' && hasGps !== false;
  const [pollMs, setPollMs] = useState<number | null>(null);
  useEffect(() => {
    if (!polling) {
      setPollMs(null);
      return;
    }
    let last = 0;
    const tick = () => {
      const every = radioPollMs(polledNodes.current);
      setPollMs(every);
      if (Date.now() - last < every) return;
      last = Date.now();
      link.current?.pollNodes();
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [polling]);

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

  const writePositionConfig = useCallback(
    async (patch: Record<number, number>) => {
      const l = link.current;
      if (!l || myNode == null || !posConfig) throw new Error('Рация не подключена');
      await l.write(setPositionConfig(myNode, patchVarints(posConfig.raw, patch), packetId()));
    },
    [myNode, posConfig]
  );

  const speedUpGps = useCallback(async () => {
    if (!posConfig || !device) throw new Error('Рация не подключена');
    if (radioHasGps(posConfig) === false) throw new Error('На рации нет включённого GPS');
    // Keep what the owner had, once (a second speed-up must not save our own values).
    if (!backup || backup.device !== device.id) {
      const b = { device: device.id, interval: posConfig.updateInterval, flags: posConfig.flags };
      setBackup(b);
      await saveJson(KEYS.radioGpsBackup, b);
    }
    await writePositionConfig({ 5: FAST_GPS_SECS, 7: posConfig.flags | POS_FLAG_DOP | POS_FLAG_SATS });
  }, [posConfig, device, backup, writePositionConfig]);

  const restoreGps = useCallback(async () => {
    if (!backup || !device || backup.device !== device.id) throw new Error('Нечего возвращать');
    await writePositionConfig({ 5: backup.interval, 7: backup.flags });
    setBackup(null);
    await saveJson(KEYS.radioGpsBackup, null);
  }, [backup, device, writePositionConfig]);

  const gps = useMemo<RadioGps>(
    () => ({
      config: posConfig,
      hasGps,
      fast: radioGpsFast(posConfig),
      pollMs,
      canRestore: Boolean(backup && device && backup.device === device.id),
    }),
    [posConfig, hasGps, pollMs, backup, device]
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
    gps,
    speedUpGps,
    restoreGps,
  };
}
