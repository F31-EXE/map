import { useEffect, useState } from 'react';

import { KEYS, loadJson, saveJson } from '../lib/storage';

/**
 * Night mode (red, dimmed screen) as app-wide state: read anywhere with useNight(),
 * including inside modals, which live outside the normal provider tree's views.
 */
let night = false;
let loaded = false;
const listeners = new Set<(v: boolean) => void>();

function emit() {
  for (const l of listeners) l(night);
}

export function setNight(v: boolean) {
  night = v;
  emit();
  saveJson(KEYS.night, v).catch(() => {});
}

export function useNight(): boolean {
  const [v, setV] = useState(night);
  useEffect(() => {
    listeners.add(setV);
    setV(night);
    if (!loaded) {
      loaded = true;
      loadJson<boolean>(KEYS.night, false).then((saved) => {
        night = saved;
        emit();
      });
    }
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}
