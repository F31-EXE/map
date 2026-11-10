import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { angleDiff, HeadingSmoother } from '../lib/heading';
import type { SelfPosition } from '../lib/types';

import { onBackgroundLocation } from '../services/backgroundLocation';

import { watchWebCompass } from './webCompass';

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
  // Compass reading on its own, so the compass works before the first GPS fix.
  const [compass, setCompass] = useState<number | null>(null);
  // The compass says it isn't calibrated (wave the phone in a figure eight).
  const [compassPoor, setCompassPoor] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let lastEmit = 0;
    const smoother = new HeadingSmoother();
    const subs: { remove: () => void }[] = [];

    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (perm.status !== 'granted') {
          setStatus('denied');
          return;
        }
        setStatus('granted');

        const onFix = (loc: Location.LocationObject) => {
          // GPS course only means something while moving; standing still it's noise.
          const moving = loc.coords.speed != null && loc.coords.speed > 1;
          const course = moving && loc.coords.heading != null && loc.coords.heading >= 0 ? loc.coords.heading : null;
          setPosition({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            accuracy: loc.coords.accuracy,
            heading: heading.current ?? course,
            timestamp: loc.timestamp,
          });
        };
        subs.push(
          await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 1 },
            onFix
          )
        );
        // With "Работа в фоне" on, fixes keep arriving through the background task
        // while the screen is off.
        subs.push({ remove: onBackgroundLocation(onFix) });

        const onRawHeading = (raw: number) => {
          const v = smoother.push(raw);
          const now = Date.now();
          // Ignore compass noise: only small-but-real turns, at most ~8 times a second.
          if (heading.current != null && angleDiff(v, heading.current) < HEADING_STEP) return;
          if (now - lastEmit < HEADING_MIN_INTERVAL_MS) return;
          lastEmit = now;
          heading.current = Math.round(v);
          setCompass(heading.current);
          setPosition((p) => (p ? { ...p, heading: heading.current } : p));
        };

        if (Platform.OS === 'web') {
          subs.push({ remove: watchWebCompass(onRawHeading) });
        } else {
          // One north only: true north once the phone has given it (it needs a location
          // fix), magnetic until then. Switching back and forth jumped by the magnetic
          // declination (~13° around Yekaterinburg) with every reading.
          let useTrue = false;
          let poorSince: number | null = null;
          try {
            subs.push(
              await Location.watchHeadingAsync((h) => {
                if (h.trueHeading >= 0) useTrue = true;
                const raw = useTrue ? h.trueHeading : h.magHeading;
                // Calibration 0 = garbage (tens of degrees off): skip it, and tell the user
                // when the compass stays uncalibrated for a few seconds.
                const now = Date.now();
                if (h.accuracy <= 1) poorSince = poorSince ?? now;
                else poorSince = null;
                setCompassPoor(poorSince != null && now - poorSince > 3000);
                if (h.accuracy === 0 || raw < 0) return;
                onRawHeading(raw);
              })
            );
          } catch {
            // No compass (e.g. emulator) — GPS course only.
          }
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

  return { position, status, heading: compass ?? position?.heading ?? null, compassPoor };
}
