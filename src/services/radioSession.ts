/**
 * The Meshtastic "phone API" session, whatever carries it (phone Bluetooth, browser
 * Bluetooth, USB serial): the config handshake, queued ToRadio writes, the heartbeat
 * and FromRadio handling. Transports subclass it and supply `send` (plus reading).
 */
import {
  decodeFromRadio,
  heartbeat,
  ONLY_NODES_NONCE,
  payloadForMtu,
  wantConfig,
  type MtChannel,
  type MtNode,
  type MtPacket,
  type MtPositionConfig,
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
  /** The radio's position settings (sent with the config). */
  onPositionConfig?: (c: MtPositionConfig) => void;
  /** A node-list poll finished; `nodes` = how many node infos it carried. */
  onNodesPolled?: (nodes: number) => void;
};

/** A poll that never completes (old firmware hiccup, lost reply) is given up after this. */
const POLL_TIMEOUT_MS = 30_000;

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
  /** When the outstanding node-list poll was sent (null = none). */
  private pollSent: number | null = null;
  private polledNodes = 0;
  private ready = false;

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
    this.ready = false;
    this.pollSent = null;
    this.nonce = (Math.floor(Math.random() * 0x7ffffffe) + 1) >>> 0;
    await this.write(wantConfig(this.nonce));
  }

  /**
   * Asks for the node list only (our node first): the way to read the radio's own GPS
   * position as it updates, with nothing sent on air. Skipped while a poll or the full
   * config is still coming.
   */
  pollNodes(): void {
    if (!this.ready || this.closed) return;
    if (this.pollSent != null && Date.now() - this.pollSent < POLL_TIMEOUT_MS) return;
    this.pollSent = Date.now();
    this.polledNodes = 0;
    this.write(wantConfig(ONLY_NODES_NONCE)).catch(() => {
      this.pollSent = null;
    });
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
        if (this.pollSent != null) this.polledNodes++;
        this.listener.onNode(msg.node);
        break;
      case 'positionConfig':
        this.listener.onPositionConfig?.(msg.config);
        break;
      case 'packet':
        this.listener.onPacket(msg.packet);
        break;
      case 'configComplete':
        if (msg.nonce === ONLY_NODES_NONCE) {
          this.pollSent = null;
          this.listener.onNodesPolled?.(this.polledNodes);
          break;
        }
        if (msg.nonce === this.nonce) {
          this.ready = true;
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
