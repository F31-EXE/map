import { useEffect, useRef, useState } from 'react';

import { KEYS, loadJson, saveJson } from '../lib/storage';
import { addCrumb, TRAIL_KEEP_MS, type TrailPoint } from '../lib/trail';
import type { SelfPosition } from '../lib/types';

/** How many minutes of own trail the map shows (0 = off), shared by settings and map. */
let minutes = 0;
let loaded = false;
const listeners = new Set<(v: number) => void>();

export function setTrailMinutes(v: number) {
  minutes = v;
  for (const l of listeners) l(v);
  saveJson(KEYS.trailMinutes, v).catch(() => {});
}

export function useTrailMinutes(): number {
  const [v, setV] = useState(minutes);
  useEffect(() => {
    listeners.add(setV);
    setV(minutes);
    if (!loaded) {
      loaded = true;
      loadJson<number>(KEYS.trailMinutes, 0).then((saved) => {
        minutes = saved;
        for (const l of listeners) l(saved);
      });
    }
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}

/** Crumbs of the last hour from own fixes, kept across restarts (saved now and then). */
export function useTrail(position: SelfPosition | null): TrailPoint[] {
  const [trail, setTrail] = useState<TrailPoint[]>([]);
  const savedAt = useRef(0);
  useEffect(() => {
    loadJson<TrailPoint[]>(KEYS.trail, []).then((t) => {
      const now = Date.now();
      setTrail((cur) => [...t.filter((c) => now - c.t <= TRAIL_KEEP_MS), ...cur]);
    });
  }, []);
  useEffect(() => {
    if (position) setTrail((t) => addCrumb(t, position, Date.now()));
  }, [position]);
  useEffect(() => {
    const now = Date.now();
    if (now - savedAt.current < 30_000) return;
    savedAt.current = now;
    saveJson(KEYS.trail, trail).catch(() => {});
  }, [trail]);
  return trail;
}
