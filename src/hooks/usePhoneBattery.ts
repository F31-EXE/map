import * as Battery from 'expo-battery';
import { useEffect, useState } from 'react';

export type PhoneBattery = { level: number | null; charging: boolean };

/**
 * This device's battery in whole percent (null where unknown: simulators, desktops
 * without a battery, browsers without the Battery API) and whether it's charging.
 */
export function usePhoneBattery(): PhoneBattery {
  const [state, setState] = useState<PhoneBattery>({ level: null, charging: false });
  useEffect(() => {
    let alive = true;
    const subs: { remove: () => void }[] = [];
    const level = (v: number) => (v >= 0 ? Math.round(v * 100) : null);
    const charging = (s: Battery.BatteryState) => s === Battery.BatteryState.CHARGING || s === Battery.BatteryState.FULL;
    (async () => {
      try {
        if (!(await Battery.isAvailableAsync())) return;
        const [l, s] = await Promise.all([Battery.getBatteryLevelAsync(), Battery.getBatteryStateAsync()]);
        if (!alive) return;
        setState({ level: level(l), charging: charging(s) });
        subs.push(
          Battery.addBatteryLevelListener((e) => setState((cur) => ({ ...cur, level: level(e.batteryLevel) }))),
          Battery.addBatteryStateListener((e) => setState((cur) => ({ ...cur, charging: charging(e.batteryState) })))
        );
      } catch {
        // No battery info here.
      }
    })();
    return () => {
      alive = false;
      subs.forEach((s) => s.remove());
    };
  }, []);
  return state;
}
