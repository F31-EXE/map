/**
 * Sets up a Meshtastic radio as a squad tracker over its own short Bluetooth (or USB)
 * link — the phone's usual radio stays connected. One edit transaction: names, primary
 * channel without positions, the squad channel with full positions, tracker position
 * settings; the radio saves and restarts on commit.
 */
import {
  beginEdit,
  CHANNEL_PRIMARY,
  CHANNEL_SECONDARY,
  commitEdit,
  packetId,
  patchVarints,
  setChannelRaw,
  setOwner,
  setPositionConfig,
  SQUAD_CHANNEL,
  TRACKER_POSITION,
  trackerSquadSettings,
  withPositionPrecision,
  type MtChannel,
  type MtPositionConfig,
} from '../lib/meshtastic';

import { RadioLink, type RadioDevice } from './meshRadio';

const READY_TIMEOUT_MS = 40_000;

export type TrackerSetup = { name: string; short: string; psk: Uint8Array };

export async function setupTracker(
  device: RadioDevice,
  opts: TrackerSetup,
  onStep: (text: string) => void
): Promise<{ num: number; longName: string }> {
  let myNode: number | null = null;
  let longName = '';
  let channels: MtChannel[] = [];
  let posConfig: MtPositionConfig | null = null;
  let fail: ((e: Error) => void) | null = null;
  let done: (() => void) | null = null;
  const ready = new Promise<void>((resolve, reject) => {
    done = resolve;
    fail = reject;
  });

  const link = new RadioLink(device.id, {
    onState: (s, err) => {
      if (s === 'connecting') onStep('Подключаюсь к ноде…');
      if (s === 'syncing') onStep('Читаю настройки ноды…');
      if (s === 'ready') done?.();
      if (s === 'off') fail?.(new Error(err || 'Нода отключилась'));
    },
    onMyNode: (n) => {
      myNode = n;
    },
    onChannels: (c) => {
      channels = c;
    },
    onNode: (n) => {
      if (n.num === myNode && n.longName) longName = n.longName;
    },
    onPacket: () => {},
    onPositionConfig: (c) => {
      posConfig = c;
    },
  });

  const timer = setTimeout(() => fail?.(new Error('Нода не ответила за 40 секунд')), READY_TIMEOUT_MS);
  try {
    await link.open();
    await ready;
    clearTimeout(timer);
    if (myNode == null) throw new Error('Нода не назвала свой номер');
    const me: number = myNode;
    onStep('Записываю настройки трекера…');
    await link.write(beginEdit(me, packetId()));
    await link.write(setOwner(me, opts.name, opts.short, packetId()));
    const primary = channels.find((c) => c.index === 0);
    if (primary?.raw) {
      // No position on the public channel: the firmware sends it on the first channel allowed.
      await link.write(setChannelRaw(me, 0, CHANNEL_PRIMARY, withPositionPrecision(primary.raw, 0), packetId()));
    }
    await link.write(setChannelRaw(me, SQUAD_CHANNEL, CHANNEL_SECONDARY, trackerSquadSettings(opts.psk), packetId()));
    const pc = posConfig as MtPositionConfig | null;
    await link.write(setPositionConfig(me, patchVarints(pc?.raw ?? new Uint8Array(0), TRACKER_POSITION), packetId()));
    await link.write(commitEdit(me, packetId()));
    onStep('Нода сохраняет настройки и перезагружается…');
    // Let the last write land before dropping the link.
    await new Promise((r) => setTimeout(r, 1500));
    return { num: me, longName };
  } finally {
    clearTimeout(timer);
    await link.close().catch(() => {});
  }
}
