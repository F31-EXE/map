/**
 * Link to a Meshtastic radio (Heltec V3 and the like) over Bluetooth LE, through
 * react-native-ble-plx. Handles scanning, connecting, the config handshake and
 * reading/writing the phone API; protocol details are in src/lib/meshtastic.ts.
 * Not in Expo Go or on the web: `radioSupported` is false there.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import type { BleManager, Device, Subscription } from 'react-native-ble-plx';

import { fromBase64, toBase64 } from '../lib/base64';
import {
  decodeFromRadio,
  heartbeat,
  MT_FROM_NUM,
  MT_FROM_RADIO,
  MT_SERVICE,
  MT_TO_RADIO,
  wantConfig,
  type MtChannel,
  type MtNode,
  type MtPacket,
} from '../lib/meshtastic';

type BleModule = typeof import('react-native-ble-plx');

let ble: BleModule | null = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ble = require('react-native-ble-plx') as BleModule;
  } catch {
    ble = null;
  }
}

let manager: BleManager | null = null;
function getManager(): BleManager | null {
  if (!ble) return null;
  if (!manager) {
    try {
      manager = new ble.BleManager();
    } catch {
      // Native module missing (Expo Go): no radio support in this build.
      ble = null;
      return null;
    }
  }
  return manager;
}

export const radioSupported = Platform.OS !== 'web' && ble != null;

export type RadioDevice = { id: string; name: string; rssi: number | null };

export type RadioState = 'off' | 'connecting' | 'syncing' | 'ready';

export type RadioListener = {
  onState: (s: RadioState, error?: string) => void;
  onMyNode: (num: number) => void;
  onChannels: (c: MtChannel[]) => void;
  onNode: (n: MtNode) => void;
  onPacket: (p: MtPacket) => void;
};

export async function requestRadioPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const P = PermissionsAndroid.PERMISSIONS;
  const api = typeof Platform.Version === 'number' ? Platform.Version : 0;
  const wanted = api >= 31 ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT] : [P.ACCESS_FINE_LOCATION];
  const res = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED);
}

/** Bluetooth is switched on (asks iOS for permission the first time). */
export async function bluetoothReady(): Promise<boolean> {
  const m = getManager();
  if (!m) return false;
  const now = await m.state();
  if (now === 'PoweredOn') return true;
  // iOS reports Unknown/Resetting for a moment after start-up.
  return new Promise((resolve) => {
    const sub = m.onStateChange((s) => {
      if (s === 'PoweredOn' || s === 'PoweredOff' || s === 'Unauthorized' || s === 'Unsupported') {
        sub.remove();
        resolve(s === 'PoweredOn');
      }
    }, true);
    setTimeout(() => {
      sub.remove();
      resolve(false);
    }, 4000);
  });
}

/** Radios advertising the Meshtastic service, as they turn up. Returns a stop function. */
export function scanRadios(onFound: (d: RadioDevice) => void, onError: (e: string) => void): () => void {
  const m = getManager();
  if (!m) {
    onError('В этой сборке нет Bluetooth-модуля');
    return () => {};
  }
  const seen = new Set<string>();
  m.startDeviceScan([MT_SERVICE], null, async (err, d) => {
    if (err) {
      onError(err.message);
      return;
    }
    if (!d || seen.has(d.id)) return;
    seen.add(d.id);
    onFound({ id: d.id, name: d.localName || d.name || 'Meshtastic', rssi: d.rssi ?? null });
  }).catch((e: Error) => onError(e.message));
  return () => {
    m.stopDeviceScan().catch(() => {});
  };
}

/** One open connection to one radio. */
export class RadioLink {
  private device: Device | null = null;
  private subs: Subscription[] = [];
  private reading = false;
  private readAgain = false;
  private writes: Promise<void> = Promise.resolve();
  private channels: MtChannel[] = [];
  private nonce = 0;
  private beat: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private listener: RadioListener;
  readonly id: string;

  constructor(id: string, listener: RadioListener) {
    this.id = id;
    this.listener = listener;
  }

  async open(): Promise<void> {
    const m = getManager();
    if (!m) throw new Error('В этой сборке нет Bluetooth-модуля');
    this.listener.onState('connecting');
    // Android: ask for a big MTU so a whole packet fits one read.
    const d = await m.connectToDevice(this.id, { requestMTU: 512, timeout: 15_000 });
    if (this.closed) {
      m.cancelDeviceConnection(this.id).catch(() => {});
      return;
    }
    this.device = await d.discoverAllServicesAndCharacteristics();
    this.subs.push(
      m.onDeviceDisconnected(this.id, (e) => {
        this.stopTimers();
        if (!this.closed) this.listener.onState('off', e?.message ?? 'Связь с рацией потеряна');
      }),
      this.device.monitorCharacteristicForService(MT_SERVICE, MT_FROM_NUM, (e) => {
        if (!e) this.drain();
      })
    );
    this.listener.onState('syncing');
    await this.requestConfig();
    // Keeps the radio's phone API session alive.
    this.beat = setInterval(() => this.write(heartbeat()).catch(() => {}), 5 * 60_000);
  }

  /** Asks the radio for its node info, channels and node list (also after changes). */
  async requestConfig(): Promise<void> {
    this.channels = [];
    this.nonce = (Math.floor(Math.random() * 0x7ffffffe) + 1) >>> 0;
    await this.write(wantConfig(this.nonce));
  }

  /** Writes one ToRadio message; writes are queued so they never overlap. */
  write(bytes: Uint8Array): Promise<void> {
    const run = this.writes.then(async () => {
      if (!this.device || this.closed) throw new Error('Рация не подключена');
      await this.device.writeCharacteristicWithResponseForService(MT_SERVICE, MT_TO_RADIO, toBase64(bytes));
      this.drain();
    });
    this.writes = run.catch(() => {});
    return run;
  }

  /** Reads FromRadio until the radio has nothing more to say. */
  private async drain() {
    if (this.reading) {
      this.readAgain = true;
      return;
    }
    this.reading = true;
    try {
      do {
        this.readAgain = false;
        for (let i = 0; i < 500 && this.device && !this.closed; i++) {
          const c = await this.device.readCharacteristicForService(MT_SERVICE, MT_FROM_RADIO);
          const bytes = c.value ? fromBase64(c.value) : new Uint8Array(0);
          if (!bytes.length) break;
          this.handle(bytes);
        }
      } while (this.readAgain && !this.closed);
    } catch (e) {
      if (!this.closed) this.listener.onState('off', (e as Error).message);
    } finally {
      this.reading = false;
    }
  }

  private handle(bytes: Uint8Array) {
    let msg;
    try {
      msg = decodeFromRadio(bytes);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'myInfo':
        this.listener.onMyNode(msg.nodeNum);
        break;
      case 'channel':
        this.channels = [...this.channels.filter((c) => c.index !== msg.channel.index), msg.channel];
        break;
      case 'node':
        this.listener.onNode(msg.node);
        break;
      case 'packet':
        this.listener.onPacket(msg.packet);
        break;
      case 'configComplete':
        if (msg.nonce === this.nonce) {
          this.listener.onChannels(this.channels);
          this.listener.onState('ready');
        }
        break;
      case 'rebooted':
        // Settings changed and the radio restarted: ask for everything again.
        this.requestConfig().catch(() => {});
        break;
    }
  }

  private stopTimers() {
    if (this.beat) clearInterval(this.beat);
    this.beat = null;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.stopTimers();
    this.subs.forEach((s) => s.remove());
    this.subs = [];
    const m = getManager();
    if (m) await m.cancelDeviceConnection(this.id).catch(() => {});
    this.device = null;
  }
}
