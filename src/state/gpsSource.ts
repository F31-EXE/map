import { useEffect, useState } from 'react';

import type { GpsMode } from '../lib/gpsSource';
import { KEYS, loadJson, saveJson } from '../lib/storage';

/**
 * Where my own position comes from (Settings → рация → «Источник координат»), app-wide:
 * read by the map screen (which fix to use) and the radio link (whether to poll the
 * radio's GPS).
 */
let mode: GpsMode = 'phone';
const listeners = new Set<(m: GpsMode) => void>();

loadJson<GpsMode>(KEYS.gpsSource, 'phone').then((saved) => {
  if (saved === 'phone' || saved === 'auto' || saved === 'radio') {
    mode = saved;
    for (const l of listeners) l(mode);
  }
});

export function setGpsMode(m: GpsMode) {
  mode = m;
  for (const l of listeners) l(mode);
  saveJson(KEYS.gpsSource, m).catch(() => {});
}

export function useGpsMode(): GpsMode {
  const [m, setM] = useState(mode);
  useEffect(() => {
    listeners.add(setM);
    setM(mode);
    return () => {
      listeners.delete(setM);
    };
  }, []);
  return m;
}
