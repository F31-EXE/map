/**
 * Link to a Meshtastic radio (Heltec V3, Heltec T114 and the like) over Bluetooth LE, through
 * react-native-ble-plx. Handles scanning, connecting, the config handshake and
 * reading/writing the phone API; protocol details are in src/lib/meshtastic.ts.
 * Not in Expo Go or on the web: `radioSupported` is false there.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import type { BleManager, Device, Subscription } from 'react-native-ble-plx';

import { fromBase64, toBase64 } from '../lib/base64';
import { looksLikeMeshtastic, MT_FROM_NUM, MT_FROM_RADIO, MT_SERVICE, MT_TO_RADIO, payloadForMtu } from '../lib/meshtastic';

import { RadioSession, type RadioDevice, type RadioListener } from './radioSession';

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

export type { RadioDevice, RadioListener, RadioState } from './radioSession';

/** Web only (browser chooser for Bluetooth or USB); phones scan instead. */
export async function pickRadio(_kind: 'ble' | 'usb'): Promise<RadioDevice | null> {
  return null;
}

export async function requestRadioPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const P = PermissionsAndroid.PERMISSIONS;
  const api = typeof Platform.Version === 'number' ? Platform.Version : 0;
  // The manifest doesn't say «never for location», so Android 12+ also hands scan
  // results only to apps holding location (and with location switched on).
  const wanted = api >= 31 ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT, P.ACCESS_FINE_LOCATION] : [P.ACCESS_FINE_LOCATION];
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

/**
 * Radios nearby, as they turn up, plus any already connected to the phone (the Meshtastic
 * app keeps its radio connected, and a connected radio stops advertising; Android lets
 * a second app use the same link). Scans unfiltered: some phones drop 128-bit UUID
 * filters, so radios are recognised by `looksLikeMeshtastic`; other named devices come
 * with `other: true` for the «all devices» list. Returns a stop function.
 */
export function scanRadios(onFound: (d: RadioDevice) => void, onError: (e: string) => void): () => void {
  const m = getManager();
  if (!m) {
    onError('В этой сборке нет Bluetooth-модуля');
    return () => {};
  }
  const seen = new Set<string>();
  m.connectedDevices([MT_SERVICE])
    .then((list) => {
      for (const d of list) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        onFound({ id: d.id, name: d.localName || d.name || 'Meshtastic', rssi: null, connected: true });
      }
    })
    .catch(() => {});
  m.startDeviceScan(null, { allowDuplicates: false, scanMode: ble?.ScanMode.LowLatency }, (err, d) => {
    if (err) {
      onError(err.message);
      return;
    }
    if (!d || seen.has(d.id)) return;
    const name = d.localName || d.name || null;
    const radio = looksLikeMeshtastic(name, d.serviceUUIDs);
    if (!radio && !name) return;
    seen.add(d.id);
    onFound({ id: d.id, name: name || 'Meshtastic', rssi: d.rssi ?? null, other: !radio });
  }).catch((e: Error) => onError(e.message));
  return () => {
    m.stopDeviceScan().catch(() => {});
  };
}

/** One open connection to one radio over the phone's Bluetooth. */
export class RadioLink extends RadioSession {
  private device: Device | null = null;
  private subs: Subscription[] = [];
  private reading = false;
  private readAgain = false;

  constructor(id: string, listener: RadioListener) {
    super(id, listener);
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
    this.maxPayload = payloadForMtu(this.device.mtu);
    this.subs.push(
      m.onDeviceDisconnected(this.id, (e) => this.lost(e?.message ?? 'Связь с рацией потеряна')),
      this.device.monitorCharacteristicForService(MT_SERVICE, MT_FROM_NUM, (e) => {
        if (!e) this.drain();
      })
    );
    await this.startSession();
  }

  protected async send(bytes: Uint8Array): Promise<void> {
    if (!this.device) throw new Error('Рация не подключена');
    await this.device.writeCharacteristicWithResponseForService(MT_SERVICE, MT_TO_RADIO, toBase64(bytes));
  }

  protected afterWrite(): void {
    this.drain();
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
