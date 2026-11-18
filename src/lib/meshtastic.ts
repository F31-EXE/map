/**
 * Meshtastic phone API over Bluetooth LE: the phone writes ToRadio protobufs to the
 * radio and reads FromRadio ones back. Field numbers follow meshtastic/protobufs
 * (mesh.proto, channel.proto, admin.proto, portnums.proto). Pure, no React Native.
 */
import { Fields, utf8Clip, utf8Encode, Writer } from './protobuf';
import { sha256 } from './sha256';

export const MT_SERVICE = '6ba1b218-15a8-461f-9fa8-5dcae273eafd';
/** Write ToRadio here. */
export const MT_TO_RADIO = 'f75c76d2-129e-4dad-a1dd-7866124401e7';
/** Read FromRadio here until it comes back empty. */
export const MT_FROM_RADIO = '2c55e69e-4993-11ed-b878-0242ac120002';
/** Notifies when FromRadio has something new. */
export const MT_FROM_NUM = 'ed9da18c-a800-4f66-a670-aa7547e34453';

/**
 * A scanned Bluetooth device is a Meshtastic radio: it advertises the Meshtastic service,
 * or carries the firmware's default name («Meshtastic_1a2b», «<short name>_1a2b») or a
 * known board's name. Some phones drop 128-bit UUID scan filters, so the app scans
 * unfiltered and decides here.
 */
export function looksLikeMeshtastic(name: string | null | undefined, serviceUUIDs: string[] | null | undefined): boolean {
  if (serviceUUIDs?.some((u) => u.toLowerCase() === MT_SERVICE)) return true;
  const n = (name ?? '').trim();
  if (!n) return false;
  return /meshtastic|heltec|t114|t-?beam|t-?echo|rak4631|wismesh|station\s?g/i.test(n) || /_[0-9a-f]{4}$/i.test(n);
}

export const PORT = { text: 1, position: 3, nodeInfo: 4, admin: 6, telemetry: 67, private: 256 } as const;
export const BROADCAST = 0xffffffff;
/** Data.payload limit (Constants.DATA_PAYLOAD_LEN). */
export const MAX_PAYLOAD = 233;

/** Bytes a ToRadio adds around a payload in `sendPacket` (checked in test/lora.test.ts). */
export const TO_RADIO_OVERHEAD = 30;

/**
 * Largest payload whose ToRadio write fits one Bluetooth packet with this ATT MTU.
 * ESP32 boards (Heltec V3) take a 512-byte MTU; nRF52 boards (Heltec T114, RAK4631)
 * stop at 247, iPhones often at 185 — a bigger write then needs a long write, which
 * not every radio firmware handles. Unknown MTU: assume the nRF52 limit.
 */
export function payloadForMtu(mtu: number | null | undefined): number {
  const m = mtu && mtu >= 23 ? mtu : 247;
  return Math.max(100, Math.min(MAX_PAYLOAD, m - 3 - TO_RADIO_OVERHEAD));
}
/** Channel slot the squad channel takes on every radio. */
export const SQUAD_CHANNEL = 1;
export const SQUAD_CHANNEL_NAME = 'GrimMap';

const CHANNEL_SECONDARY = 2;

export function wantConfig(nonce: number): Uint8Array {
  return new Writer().uint(3, nonce >>> 0).finish();
}

export function heartbeat(): Uint8Array {
  return new Writer().message(7, new Writer()).finish();
}

export function sendPacket(p: {
  to?: number;
  channel: number;
  portnum: number;
  payload: Uint8Array;
  id: number;
  wantResponse?: boolean;
  /** Times other radios may repeat it; Meshtastic's default is 3. */
  hopLimit?: number;
}): Uint8Array {
  const data = new Writer().uint(1, p.portnum).bytesField(2, p.payload).bool(3, Boolean(p.wantResponse));
  const packet = new Writer()
    .fixed32(2, p.to ?? BROADCAST)
    .uint(3, p.channel)
    .message(4, data)
    .fixed32(6, p.id >>> 0)
    .uint(9, p.hopLimit ?? 3);
  return new Writer().message(1, packet).finish();
}

/**
 * Admin command to our own radio: put the squad channel into slot SQUAD_CHANNEL as a
 * secondary channel. Secondary channels share the primary's frequency, so the radio
 * stays on its usual mesh and only squadmates (same key) can read GrimMap traffic.
 */
export function setSquadChannel(myNode: number, psk: Uint8Array, id: number): Uint8Array {
  const settings = new Writer().bytesField(2, psk).string(3, SQUAD_CHANNEL_NAME);
  const channel = new Writer().uint(1, SQUAD_CHANNEL).message(2, settings).uint(3, CHANNEL_SECONDARY);
  const admin = new Writer().message(33, channel).finish();
  return sendPacket({ to: myNode, channel: 0, portnum: PORT.admin, payload: admin, id, wantResponse: true });
}

/** AES-256 key of the squad channel: the same on every squadmate's radio. */
export function squadPsk(teamId: string): Uint8Array {
  return sha256(utf8Encode(`grimmap-squad:${teamId}`));
}

export type MtChannel = { index: number; role: number; name: string; psk: Uint8Array };

export type MtPacket = {
  from: number;
  to: number;
  channel: number;
  id: number;
  portnum: number;
  payload: Uint8Array;
  rxTime: number;
  snr: number | null;
  rssi: number;
  /** Hops it took (hop_start − hop_limit), when the sender's firmware reports it. */
  hops: number | null;
};

export type MtNode = {
  num: number;
  longName: string;
  shortName: string;
  lat: number | null;
  lng: number | null;
  lastHeard: number;
  /** Battery %, 101 = on external power (DeviceMetrics.battery_level), if reported. */
  battery?: number | null;
  /** The node's position in full (fix time, source), when it has one. */
  pos?: MtPosition | null;
};

export type FromRadio =
  | { type: 'myInfo'; nodeNum: number }
  | { type: 'node'; node: MtNode }
  | { type: 'channel'; channel: MtChannel }
  | { type: 'packet'; packet: MtPacket }
  | { type: 'configComplete'; nonce: number }
  | { type: 'positionConfig'; config: MtPositionConfig }
  | { type: 'rebooted' }
  | { type: 'other' };

/**
 * A Position message (mesh.proto): latitude_i 1 / longitude_i 2 (1e-7 degrees), time 4,
 * location_source 5 (1 manual, 2 internal GPS, 3 external), PDOP 11 / HDOP 12 (1/100),
 * gps_accuracy 14 (mm, the receiver's constant), sats_in_view 19. DOPs and satellites are
 * only there when the radio's position flags ask for them.
 */
export type MtPosition = {
  lat: number;
  lng: number;
  /** Fix time on the radio's clock, seconds (0 = unknown). */
  time: number;
  source: number;
  pdop: number;
  hdop: number;
  gpsAccuracy: number;
  sats: number;
};

export function decodePosition(b: Uint8Array): MtPosition | null {
  const f = new Fields(b);
  if (!f.has(1) || !f.has(2)) return null;
  const lat = f.int(1) / 1e7;
  const lng = f.int(2) / 1e7;
  // A radio that lost its fix reports 0, 0.
  if (!lat && !lng) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {
    lat,
    lng,
    time: f.uint(4),
    source: f.uint(5),
    pdop: f.uint(11),
    hdop: f.uint(12),
    gpsAccuracy: f.uint(14),
    sats: f.uint(19),
  };
}

/** location_source: set by hand (a fixed position), not a GPS fix. */
export const LOC_MANUAL = 1;

/**
 * Rough horizontal accuracy of a radio's fix in metres: DOP × the receiver's error
 * (gps_accuracy, mm; ~5 m when not reported), HDOP preferred. Null without a DOP.
 */
export function radioAccuracy(p: Pick<MtPosition, 'pdop' | 'hdop' | 'gpsAccuracy'>): number | null {
  const dop = (p.hdop || p.pdop) / 100;
  if (!dop) return null;
  const uere = p.gpsAccuracy ? p.gpsAccuracy / 1000 : 5;
  return Math.max(1, Math.round(dop * uere * 10) / 10);
}

/**
 * want_config nonce that makes firmware 2.6+ send only the node list, our own node
 * first (PhoneAPI SPECIAL_NONCE_ONLY_NODES). Our node's position there follows the
 * radio's GPS (updated at gps_update_interval) without anything going on air. Older
 * firmware answers with the whole config instead — heavier, same result.
 */
export const ONLY_NODES_NONCE = 69421;

/** Config.PositionConfig as the radio reported it; `raw` is kept to write it back whole. */
export type MtPositionConfig = {
  raw: Uint8Array;
  broadcastSecs: number;
  fixed: boolean;
  /** gps_enabled (deprecated, older firmware). */
  gpsEnabled: boolean;
  updateInterval: number;
  flags: number;
  /** gps_mode: 0 disabled, 1 enabled, 2 not present; null on firmware without it. */
  gpsMode: number | null;
};

export const POS_FLAG_DOP = 0x0008;
export const POS_FLAG_SATS = 0x0020;
/** How often the radio's GPS updates in «GPS рации» mode, seconds. */
export const FAST_GPS_SECS = 5;

export function decodePositionConfig(raw: Uint8Array): MtPositionConfig {
  const f = new Fields(raw);
  return {
    raw,
    broadcastSecs: f.uint(1),
    fixed: f.uint(3) !== 0,
    gpsEnabled: f.uint(4) !== 0,
    updateInterval: f.uint(5),
    flags: f.uint(7),
    gpsMode: f.has(13) ? f.uint(13) : null,
  };
}

/** The radio has a GPS that is switched on (and isn't just repeating a fixed position). */
export function radioHasGps(c: MtPositionConfig | null): boolean | null {
  if (!c) return null;
  if (c.fixed) return false;
  // proto3 leaves out zeros: no gps_mode means DISABLED on current firmware, but old
  // firmware only had gps_enabled.
  return c.gpsMode != null ? c.gpsMode === 1 : c.gpsEnabled;
}

/** The radio's GPS already updates often and reports its precision. */
export function radioGpsFast(c: MtPositionConfig | null): boolean {
  if (!c) return false;
  // 0 means the firmware default (2 minutes).
  return c.updateInterval > 0 && c.updateInterval <= 10 && (c.flags & POS_FLAG_DOP) !== 0;
}

/**
 * Copies a message, replacing (or adding) the given varint fields and keeping every
 * other field byte for byte — fields this app doesn't know survive a write-back.
 */
export function patchVarints(raw: Uint8Array, patch: Record<number, number>): Uint8Array {
  const out = new Writer();
  const parts: Uint8Array[] = [];
  let i = 0;
  const varint = () => {
    let v = 0;
    let mul = 1;
    for (;;) {
      const b = raw[i++];
      if (b === undefined) throw new Error('truncated varint');
      v += (b & 0x7f) * mul;
      if (b < 0x80) return v;
      mul *= 128;
    }
  };
  while (i < raw.length) {
    const start = i;
    const key = varint();
    const no = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) varint();
    else if (wire === 5) i += 4;
    else if (wire === 1) i += 8;
    else if (wire === 2) {
      // Read the length first: `i += varint()` would add it to the old `i`.
      const n = varint();
      i += n;
    }
    else throw new Error(`wire type ${wire}`);
    if (i > raw.length) throw new Error('truncated field');
    if (!(no in patch)) parts.push(raw.slice(start, i));
  }
  for (const [no, v] of Object.entries(patch)) out.uint(Number(no), v);
  const tail = out.finish();
  const total = parts.reduce((n, p) => n + p.length, 0) + tail.length;
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.length;
  }
  buf.set(tail, o);
  return buf;
}

/**
 * Admin set_config (34) of Config.position (2) for our own radio. The firmware saves
 * it and reboots (~10 s); the link comes back by itself.
 */
export function setPositionConfig(myNode: number, raw: Uint8Array, id: number): Uint8Array {
  const config = new Writer().bytesField(2, raw);
  const admin = new Writer().message(34, config).finish();
  return sendPacket({ to: myNode, channel: 0, portnum: PORT.admin, payload: admin, id, wantResponse: true });
}

/**
 * Battery % out of a Telemetry message (TELEMETRY_APP): device_metrics (2) →
 * battery_level (1). 101 means powered from outside. Null for other telemetry.
 */
export function decodeTelemetryBattery(b: Uint8Array): number | null {
  const dm = new Fields(b).bytes(2);
  if (!dm) return null;
  const f = new Fields(dm);
  return f.has(1) ? f.uint(1) : null;
}

export function decodeUser(b: Uint8Array): { longName: string; shortName: string } {
  const f = new Fields(b);
  return { longName: f.string(2), shortName: f.string(3) };
}

export function decodeFromRadio(buf: Uint8Array): FromRadio {
  const f = new Fields(buf);
  const packet = f.message(2);
  if (packet) {
    const data = packet.message(4);
    // Packets still encrypted are on channels this radio has no key for.
    if (!data) return { type: 'other' };
    const hopStart = packet.uint(15);
    return {
      type: 'packet',
      packet: {
        from: packet.uint(1),
        to: packet.uint(2),
        channel: packet.uint(3),
        id: packet.uint(6),
        portnum: data.uint(1),
        payload: data.bytes(2) ?? new Uint8Array(0),
        rxTime: packet.uint(7),
        snr: packet.float(8),
        rssi: packet.int(12),
        hops: hopStart ? hopStart - packet.uint(9) : null,
      },
    };
  }
  const my = f.message(3);
  if (my) return { type: 'myInfo', nodeNum: my.uint(1) };
  const node = f.message(4);
  if (node) {
    const user = node.bytes(2);
    const pos = node.bytes(3);
    const u = user ? decodeUser(user) : { longName: '', shortName: '' };
    const p = pos ? decodePosition(pos) : null;
    // NodeInfo.device_metrics (6) → battery_level (1).
    const dm = node.bytes(6);
    const df = dm ? new Fields(dm) : null;
    return {
      type: 'node',
      node: {
        num: node.uint(1),
        ...u,
        lat: p?.lat ?? null,
        lng: p?.lng ?? null,
        lastHeard: node.uint(5),
        battery: df?.has(1) ? df.uint(1) : null,
        pos: p,
      },
    };
  }
  const ch = f.message(10);
  if (ch) {
    const s = ch.message(2);
    return {
      type: 'channel',
      channel: { index: ch.int(1), role: ch.uint(3), name: s?.string(3) ?? '', psk: s?.bytes(2) ?? new Uint8Array(0) },
    };
  }
  // Config (5) → position (2).
  const cfg = f.message(5);
  const posCfg = cfg?.bytes(2);
  if (posCfg) return { type: 'positionConfig', config: decodePositionConfig(posCfg) };
  if (f.has(7)) return { type: 'configComplete', nonce: f.uint(7) };
  if (f.has(8)) return { type: 'rebooted' };
  return { type: 'other' };
}

/** Whether the radio's slot already holds our squad channel with the right key. */
export function hasSquadChannel(channels: MtChannel[], psk: Uint8Array): boolean {
  const c = channels.find((x) => x.index === SQUAD_CHANNEL);
  return Boolean(c && c.role !== 0 && c.psk.length === psk.length && c.psk.every((b, i) => b === psk[i]));
}

/** "!a1b2c3d4", the way Meshtastic names nodes. */
export function nodeIdText(num: number): string {
  return `!${(num >>> 0).toString(16).padStart(8, '0')}`;
}

/** A message id for MeshPacket.id (non-zero, 32-bit). */
export function packetId(): number {
  return (Math.floor(Math.random() * 0xfffffffe) + 1) >>> 0;
}

/** Text for a plain Meshtastic chat message, clipped to fit one packet. */
export function textPayload(s: string): Uint8Array {
  return utf8Clip(s, MAX_PAYLOAD);
}
