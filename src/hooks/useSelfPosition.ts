import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';

import { angleDiff, HeadingSmoother } from '../lib/heading';
import type { SelfPosition } from '../lib/types';

const HEADING_STEP = 4;
const HEADING_MIN_INTERVAL_MS = 120;

export type LocationStatus = 'pending' | 'granted' | 'denied' | 'error';

/**
 * Foreground GPS + compass. Heading comes from the compass (works while standing
 * still), falling back to GPS course.
 */
export function useSelfPosition(enabled = true) {
  const [position, setPosition] = useState<SelfPosition | null>(null);
  const [status, setStatus] = useState<LocationStatus>('pending');
  const heading = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let lastEmit = 0;
    const smoother = new HeadingSmoother();
    const subs: Location.LocationSubscription[] = [];

    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (perm.status !== 'granted') {
          setStatus('denied');
          return;
        }
        setStatus('granted');

        subs.push(
          await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 1 },
            (loc) => {
              const course = loc.coords.heading != null && loc.coords.heading >= 0 ? loc.coords.heading : null;
              setPosition({
                lat: loc.coords.latitude,
                lng: loc.coords.longitude,
                accuracy: loc.coords.accuracy,
                heading: heading.current ?? course,
                timestamp: loc.timestamp,
              });
            }
          )
        );

        try {
          subs.push(
            await Location.watchHeadingAsync((h) => {
              const raw = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
              if (raw < 0) return;
              const v = smoother.push(raw);
              const now = Date.now();
              // Ignore compass noise: only small-but-real turns, at most ~8 times a second.
              if (heading.current != null && angleDiff(v, heading.current) < HEADING_STEP) return;
              if (now - lastEmit < HEADING_MIN_INTERVAL_MS) return;
              lastEmit = now;
              heading.current = Math.round(v);
              setPosition((p) => (p ? { ...p, heading: heading.current } : p));
            })
          );
        } catch {
          // No compass (e.g. emulator) — GPS course only.
        }
      } catch {
        if (!cancelled) setStatus('error');
      }
      if (cancelled) subs.forEach((s) => s.remove());
    })();

    return () => {
      cancelled = true;
      subs.forEach((s) => s.remove());
    };
  }, [enabled]);

  return { position, status };
}
