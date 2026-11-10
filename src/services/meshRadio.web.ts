/**
 * Meshtastic radios in the browser (desktop Chrome / Edge / Opera): over Bluetooth
 * (Web Bluetooth, the same GATT service as on phones) or over a USB cable (Web Serial,
 * Meshtastic's framed stream: 0x94 0xC3, 2-byte length, protobuf). Firefox and Safari
 * have neither: `radioSupported` is false there.
 *
 * Browsers only let a page pick a device from a click (`pickRadio`); later connections
 * reuse the permission through getDevices() / getPorts().
 */
import { MAX_PAYLOAD, MT_FROM_NUM, MT_FROM_RADIO, MT_SERVICE, MT_TO_RADIO, payloadForMtu } from '../lib/meshtastic';

import { frame, FrameParser, START2 } from '../lib/serialFrames';

import { RadioSession, type RadioDevice, type RadioListener } from './radioSession';

export type { RadioDevice, RadioListener, RadioState } from './radioSession';

/* Minimal typings: Web Bluetooth and Web Serial aren't in TypeScript's DOM lib. */
type Characteristic = {
  readValue(): Promise<DataView>;
  writeValueWithResponse(b: Uint8Array): Promise<void>;
  startNotifications(): Promise<Characteristic>;
  addEventListener(t: string, f: () => void): void;
};
type BtDevice = {
  id: string;
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<{ getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<Characteristic> }> }>;
    disconnect(): void;
  };
  addEventListener(t: string, f: () => void): void;
  removeEventListener(t: string, f: () => void): void;
};
type Port = {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
};
type Nav = {
  bluetooth?: { requestDevice(o: unknown): Promise<BtDevice>; getDevices?(): Promise<BtDevice[]> };
  serial?: { requestPort(o?: unknown): Promise<Port>; getPorts(): Promise<Port[]> };
};

const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Nav;
const service = MT_SERVICE.toLowerCase();

export const bluetoothSupported = Boolean(nav.bluetooth);
export const usbSupported = Boolean(nav.serial);
export const radioSupported = bluetoothSupported || usbSupported;

// Devices picked in this tab, by our id.
const picked = new Map<string, BtDevice | Port>();
const USB_ID = 'usb';

export async function requestRadioPermissions(): Promise<boolean> {
  return true;
}

export async function bluetoothReady(): Promise<boolean> {
  return true;
}

/** Browsers can't scan in the background: devices come from `pickRadio`. */
export function scanRadios(_onFound: (d: RadioDevice) => void, onError: (e: string) => void): () => void {
  onError('Выберите рацию кнопкой «Bluetooth» или «USB-кабель»');
  return () => {};
}

/** Opens the browser's device chooser. Must run from a click. */
export async function pickRadio(kind: 'ble' | 'usb'): Promise<RadioDevice | null> {
  try {
    if (kind === 'usb') {
      if (!nav.serial) throw new Error('Этот браузер не умеет USB: откройте карту в Chrome или Edge');
      const port = await nav.serial.requestPort();
      picked.set(USB_ID, port);
      return { id: USB_ID, name: 'Рация по USB', rssi: null, transport: 'usb' };
    }
    if (!nav.bluetooth) throw new Error('Этот браузер не умеет Bluetooth: откройте карту в Chrome или Edge');
    const d = await nav.bluetooth.requestDevice({ filters: [{ services: [service] }], optionalServices: [service] });
    picked.set(d.id, d);
    return { id: d.id, name: d.name || 'Meshtastic', rssi: null, transport: 'ble' };
  } catch (e) {
    // Closing the chooser isn't an error.
    if ((e as Error).name === 'NotFoundError' || (e as Error).name === 'AbortError') return null;
    throw e;
  }
}

async function findBluetooth(id: string): Promise<BtDevice | null> {
  const d = picked.get(id);
  if (d && 'gatt' in d) return d;
  const known = (await nav.bluetooth?.getDevices?.()) ?? [];
  return known.find((x) => x.id === id) ?? null;
}

async function findPort(): Promise<Port | null> {
  const p = picked.get(USB_ID);
  if (p && 'readable' in p) return p;
  const ports = (await nav.serial?.getPorts()) ?? [];
  return ports[0] ?? null;
}

/** One open connection: Bluetooth or USB, by the id `pickRadio` gave. */
export class RadioLink extends RadioSession {
  private impl: BleLink | UsbLink;

  constructor(id: string, listener: RadioListener) {
    super(id, listener);
    this.impl = id === USB_ID ? new UsbLink(this) : new BleLink(this);
  }

  async open(): Promise<void> {
    this.listener.onState('connecting');
    await this.impl.open();
    if (this.closed) return;
    this.maxPayload = this.impl.maxPayload;
    await this.startSession();
  }

  protected send(bytes: Uint8Array): Promise<void> {
    return this.impl.send(bytes);
  }

  protected afterWrite(): void {
    this.impl.afterWrite();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.stopTimers();
    await this.impl.close();
  }

  // For the transports.
  received(bytes: Uint8Array) {
    if (!this.closed) this.handle(bytes);
  }
  dropped(message: string) {
    this.lost(message);
  }
  get isClosed() {
    return this.closed;
  }
}

class BleLink {
  // Chrome does long writes, but nRF52 radios may not: stay inside one packet.
  maxPayload = payloadForMtu(null);
  private device: BtDevice | null = null;
  private toRadio: Characteristic | null = null;
  private fromRadio: Characteristic | null = null;
  private reading = false;
  private readAgain = false;
  private onDisconnect = () => this.link.dropped('Связь с рацией потеряна');

  constructor(private link: RadioLink) {}

  async open() {
    const d = await findBluetooth(this.link.id);
    if (!d?.gatt) throw new Error('Браузер забыл рацию: нажмите «Bluetooth» и выберите её ещё раз');
    this.device = d;
    d.addEventListener('gattserverdisconnected', this.onDisconnect);
    const server = await d.gatt.connect();
    const svc = await server.getPrimaryService(service);
    this.toRadio = await svc.getCharacteristic(MT_TO_RADIO.toLowerCase());
    this.fromRadio = await svc.getCharacteristic(MT_FROM_RADIO.toLowerCase());
    const fromNum = await svc.getCharacteristic(MT_FROM_NUM.toLowerCase());
    fromNum.addEventListener('characteristicvaluechanged', () => this.drain());
    await fromNum.startNotifications();
  }

  async send(bytes: Uint8Array) {
    if (!this.toRadio) throw new Error('Рация не подключена');
    await this.toRadio.writeValueWithResponse(bytes);
  }

  afterWrite() {
    this.drain();
  }

  private async drain() {
    if (this.reading) {
      this.readAgain = true;
      return;
    }
    this.reading = true;
    try {
      do {
        this.readAgain = false;
        for (let i = 0; i < 500 && this.fromRadio && !this.link.isClosed; i++) {
          const v = await this.fromRadio.readValue();
          if (!v.byteLength) break;
          this.link.received(new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)));
        }
      } while (this.readAgain && !this.link.isClosed);
    } catch (e) {
      this.link.dropped((e as Error).message);
    } finally {
      this.reading = false;
    }
  }

  async close() {
    this.device?.removeEventListener('gattserverdisconnected', this.onDisconnect);
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.device = null;
    this.toRadio = this.fromRadio = null;
  }
}

class UsbLink {
  maxPayload = MAX_PAYLOAD;
  private port: Port | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(private link: RadioLink) {}

  async open() {
    const port = await findPort();
    if (!port) throw new Error('Браузер забыл рацию: нажмите «USB-кабель» и выберите её ещё раз');
    this.port = port;
    try {
      await port.open({ baudRate: 115200 });
    } catch (e) {
      // Already open in this tab (a reconnect): fine; anything else is real.
      if ((e as Error).name !== 'InvalidStateError') throw e;
    }
    if (!port.writable || !port.readable) throw new Error('Порт рации занят другой программой');
    this.writer = port.writable.getWriter();
    // Wakes the radio's serial API (as the Meshtastic clients do).
    await this.writer.write(new Uint8Array(32).fill(START2));
    this.readLoop(port.readable.getReader());
  }

  private async readLoop(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.reader = reader;
    const parser = new FrameParser();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) for (const f of parser.push(value)) this.link.received(f);
      }
    } catch (e) {
      this.link.dropped((e as Error).message || 'Кабель рации отключён');
      return;
    }
    if (!this.link.isClosed) this.link.dropped('Кабель рации отключён');
  }

  async send(bytes: Uint8Array) {
    if (!this.writer) throw new Error('Рация не подключена');
    await this.writer.write(frame(bytes));
  }

  afterWrite() {}

  async close() {
    try {
      await this.reader?.cancel();
    } catch {
      // Already gone.
    }
    this.reader?.releaseLock();
    this.writer?.releaseLock();
    this.reader = null;
    this.writer = null;
    await this.port?.close().catch(() => {});
    this.port = null;
  }
}
