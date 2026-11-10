/**
 * «Вести по маршруту»: following a drawn arrow point by point. Pure, tested in
 * test/route.test.ts.
 */
import { distanceMeters } from './geo';
import type { LatLng } from './types';

/** Where to start: the route point nearest to me (the start itself if I'm there). */
export function routeStart(points: LatLng[], me: LatLng): number {
  let best = 0;
  let bestD = Infinity;
  points.forEach((p, i) => {
    const d = distanceMeters(me, p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * The point to head for now: moves on past every point I'm within `arriveM` of
 * (several at once if they're close together). Equals points.length - 1 at the end.
 */
export function routeStep(points: LatLng[], idx: number, me: LatLng, arriveM: number): number {
  let i = Math.max(0, Math.min(idx, points.length - 1));
  while (i < points.length - 1 && distanceMeters(me, points[i]) <= arriveM) i++;
  return i;
}

/** Meters left: to the current point, then along the rest of the route. */
export function routeRemaining(points: LatLng[], idx: number, me: LatLng): number {
  if (!points.length) return 0;
  const i = Math.max(0, Math.min(idx, points.length - 1));
  let d = distanceMeters(me, points[i]);
  for (let k = i + 1; k < points.length; k++) d += distanceMeters(points[k - 1], points[k]);
  return d;
}
