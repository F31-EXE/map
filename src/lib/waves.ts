/**
 * Respawn waves: groups leave the respawn (e.g. by helicopter) every `every` ms,
 * counted from a departure at `start`. Set by commanders on respawn / dead-zone
 * markers; everyone sees the countdown.
 */
export type Wave = { every: number; start: number };

export const WAVE_PRESETS_MIN = [5, 10, 15, 20, 30];
export const MAX_WAVE_MIN = 180;

/** Next departure at or after `now`. */
export function nextWave(w: Wave, now: number): number {
  if (now <= w.start) return w.start;
  const k = Math.ceil((now - w.start) / w.every);
  return w.start + k * w.every;
}

/** The next few departures, for the marker card. */
export function upcomingWaves(w: Wave, now: number, count = 3): number[] {
  const first = nextWave(w, now);
  return Array.from({ length: count }, (_, i) => first + i * w.every);
}

/** "4:05", or "1:02:05" over an hour. */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function validWave(w: unknown): w is Wave {
  if (!w || typeof w !== 'object') return false;
  const o = w as Record<string, unknown>;
  return (
    typeof o.every === 'number' &&
    o.every >= 60_000 &&
    o.every <= MAX_WAVE_MIN * 60_000 &&
    typeof o.start === 'number' &&
    Number.isFinite(o.start)
  );
}

/** Shifts the schedule (e.g. "the helicopter was a minute late"). */
export function shiftWave(w: Wave, deltaMs: number): Wave {
  return { ...w, start: w.start + deltaMs };
}
