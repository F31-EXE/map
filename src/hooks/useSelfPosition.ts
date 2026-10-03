import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';

import type { SelfPosition } from '../lib/types';

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
              const v = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
              // Quantize so the map isn't flooded with tiny rotations.
              const q = Math.round(v / 5) * 5;
              if (q === heading.current) return;
              heading.current = q;
              setPosition((p) => (p ? { ...p, heading: q } : p));
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
