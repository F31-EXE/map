/**
 * The Meshtastic "phone API" session, whatever carries it (phone Bluetooth, browser
 * Bluetooth, USB serial): the config handshake, queued ToRadio writes, the heartbeat
 * and FromRadio handling. Transports subclass it and supply `send` (plus reading).
 */
import {
  decodeFromRadio,
  heartbeat,
  payloadForMtu,
  wantConfig,
  type MtChannel,
  type MtNode,
  type MtPacket,
} from '../lib/meshtastic';

/** A radio the user picked. `transport` is set on the web (Bluetooth or USB cable). */
export type RadioDevice = {
  id: string;
  name: string;
  rssi: number | null;
  transport?: 'ble' | 'usb';
  /** Found among devices already connected to the phone (e.g. by the Meshtastic app). */
  connected?: boolean;
  /** Not recognised as a radio: listed only under «Все устройства». */
  other?: boolean;
};

export type RadioState = 'off' | 'connecting' | 'syncing' | 'ready';

export type RadioListener = {
  onState: (s: RadioState, error?: string) => void;
  onMyNode: (num: number) => void;
  onChannels: (c: MtChannel[]) => void;
  onNode: (n: MtNode) => void;
  onPacket: (p: MtPacket) => void;
};

export abstract class RadioSession {
  /** Largest payload per packet one write over this link takes (see payloadForMtu). */
  maxPayload = payloadForMtu(null);
  readonly id: string;
  protected listener: RadioListener;
  protected closed = false;
  private writes: Promise<void> = Promise.resolve();
  private channels: MtChannel[] = [];
  private nonce = 0;
  private beat: ReturnType<typeof setInterval> | null = null;

  constructor(id: string, listener: RadioListener) {
    this.id = id;
    this.listener = listener;
  }

  abstract open(): Promise<void>;
  abstract close(): Promise<void>;
  /** Puts one ToRadio message on the wire. */
  protected abstract send(bytes: Uint8Array): Promise<void>;
  /** Called after each write (Bluetooth reads the radio's answer then). */
  protected afterWrite(): void {}

  /** Handshake and heartbeat, once the transport is up. */
  protected async startSession(): Promise<void> {
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
      if (this.closed) throw new Error('Рация не подключена');
      await this.send(bytes);
      this.afterWrite();
    });
    this.writes = run.catch(() => {});
    return run;
  }

  protected handle(bytes: Uint8Array) {
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

  protected stopTimers() {
    if (this.beat) clearInterval(this.beat);
    this.beat = null;
  }

  /** The link dropped by itself. */
  protected lost(message: string) {
    this.stopTimers();
    if (!this.closed) this.listener.onState('off', message);
  }
}
