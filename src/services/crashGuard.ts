import AsyncStorage from '@react-native-async-storage/async-storage';

import { GrimMesh } from '../../modules/grim-mesh';

/**
 * Keeps a crash at startup from locking the user out of the app.
 *
 * Every launch marks itself "starting"; after a while of running fine it marks itself
 * healthy. If two launches in a row never got there, the app crashed early twice, so
 * the next launch starts in safe mode: features that start native code on their own
 * (Bluetooth mesh, background location) stay off until switched on again by hand.
 * The last JS error is kept so it can be shown and sent to the developer.
 */
const BOOT = 'tacmap.boot';
const LAST_ERROR = 'tacmap.lastError';
const HEALTHY_AFTER_MS = 20_000;

type Boot = { starting: boolean; streak: number };

let safeMode: boolean | null = null;
let checking: Promise<boolean> | null = null;

/** True when the previous launches crashed early; computed once per launch. */
export function checkSafeMode(): Promise<boolean> {
  if (checking) return checking;
  checking = (async () => {
    let boot: Boot = { starting: false, streak: 0 };
    try {
      const raw = await AsyncStorage.getItem(BOOT);
      if (raw) boot = JSON.parse(raw) as Boot;
    } catch {
      // Corrupt entry: start clean.
    }
    // A native crash (Android) left its stack trace behind: keep it for Settings.
    try {
      const native = GrimMesh?.takeNativeCrash?.();
      if (native) await AsyncStorage.setItem(LAST_ERROR, `NATIVE ${native}`.slice(0, 8000));
    } catch {
      // Older build without the recorder.
    }
    const streak = boot.starting ? boot.streak + 1 : 0;
    safeMode = streak >= 2;
    await AsyncStorage.setItem(BOOT, JSON.stringify({ starting: true, streak })).catch(() => {});
    setTimeout(() => {
      AsyncStorage.setItem(BOOT, JSON.stringify({ starting: false, streak: 0 })).catch(() => {});
    }, HEALTHY_AFTER_MS);
    return safeMode;
  })();
  return checking;
}

export async function recordError(e: unknown, fatal: boolean): Promise<void> {
  const err = e as Error;
  const text = `${fatal ? 'FATAL ' : ''}${new Date().toISOString()}\n${err?.name ?? 'Error'}: ${err?.message ?? String(e)}\n${(err?.stack ?? '').split('\n').slice(0, 8).join('\n')}`;
  await AsyncStorage.setItem(LAST_ERROR, text.slice(0, 4000)).catch(() => {});
}

export async function lastError(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_ERROR).catch(() => null);
}

export async function clearLastError(): Promise<void> {
  await AsyncStorage.removeItem(LAST_ERROR).catch(() => {});
}

type ErrorUtilsT = {
  getGlobalHandler: () => (e: unknown, isFatal?: boolean) => void;
  setGlobalHandler: (h: (e: unknown, isFatal?: boolean) => void) => void;
};

/** Remembers uncaught JS errors before the default handler (red box / crash) runs. */
export function installErrorRecorder() {
  const eu = (globalThis as unknown as { ErrorUtils?: ErrorUtilsT }).ErrorUtils;
  if (!eu) return;
  const prev = eu.getGlobalHandler();
  eu.setGlobalHandler((e, isFatal) => {
    recordError(e, Boolean(isFatal));
    prev(e, isFatal);
  });
}
