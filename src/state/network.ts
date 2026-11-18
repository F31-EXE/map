import { disableNetwork, enableNetwork } from 'firebase/firestore';
import { useEffect, useState } from 'react';

import { firestore, isFirebaseConfigured } from '../lib/firebase';
import { KEYS, loadJson, saveJson } from '../lib/storage';

/**
 * «Интернет (LTE)» channel on/off (Settings → «Каналы связи»). Off puts Firestore
 * offline: nothing goes to or comes from the server (writes wait in the local cache and
 * go out once it's back on), so the squad is reached only over the Meshtastic radio.
 */
let lte = true;
const listeners = new Set<(v: boolean) => void>();

function apply(v: boolean) {
  if (!isFirebaseConfigured) return;
  (v ? enableNetwork(firestore()) : disableNetwork(firestore())).catch(() => {});
}

loadJson<boolean>(KEYS.lte, true).then((saved) => {
  if (saved === false) {
    lte = false;
    apply(false);
    for (const l of listeners) l(lte);
  }
});

export function setLte(v: boolean) {
  lte = v;
  apply(v);
  for (const l of listeners) l(lte);
  saveJson(KEYS.lte, v).catch(() => {});
}

export const getLte = () => lte;

export function useLte(): boolean {
  const [v, setV] = useState(lte);
  useEffect(() => {
    listeners.add(setV);
    setV(lte);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}
