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
};

export type FromRadio =
  | { type: 'myInfo'; nodeNum: number }
  | { type: 'node'; node: MtNode }
  | { type: 'channel'; channel: MtChannel }
  | { type: 'packet'; packet: MtPacket }
  | { type: 'configComplete'; nonce: number }
  | { type: 'rebooted' }
  | { type: 'other' };

/** Latitude/longitude out of a Position message (integers in 1e-7 degrees). */
export function decodePosition(b: Uint8Array): { lat: number; lng: number } | null {
  const f = new Fields(b);
  if (!f.has(1) || !f.has(2)) return null;
  const lat = f.int(1) / 1e7;
  const lng = f.int(2) / 1e7;
  if (!lat && !lng) return null;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
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
