/**
 * Spoken navigation hints ("правее 40 градусов, 120 метров"), so a fighter can follow
 * a point or a route with the phone in a pocket. Pure: decides what to say and when;
 * src/services/speech.ts does the talking.
 */

/** Russian noun form for a count: 1 метр, 2 метра, 5 метров. */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

export function sayDistance(m: number): string {
  if (m >= 1000) {
    const km = Math.floor(m / 1000);
    const rest = Math.round((m - km * 1000) / 100) * 100;
    const kmText = `${km} ${plural(km, 'километр', 'километра', 'километров')}`;
    return rest > 0 && rest < 1000 ? `${kmText} ${rest} метров` : kmText;
  }
  const r = m < 100 ? Math.max(5, Math.round(m / 5) * 5) : Math.round(m / 10) * 10;
  return `${r} ${plural(r, 'метр', 'метра', 'метров')}`;
}

/** Turn relative to where the phone points; null without a compass. */
export function sayTurn(turn: number | null): string | null {
  if (turn == null) return null;
  const a = Math.abs(turn);
  if (a <= 15) return 'прямо';
  if (a >= 150) return 'цель позади';
  const d = Math.round(a / 5) * 5;
  return `${turn > 0 ? 'правее' : 'левее'} ${d} ${plural(d, 'градус', 'градуса', 'градусов')}`;
}

export function sayHint(distance: number, turn: number | null): string {
  const t = sayTurn(turn);
  return t ? `${t}, ${sayDistance(distance)}` : sayDistance(distance);
}

const MILESTONES = [1000, 500, 300, 200, 100, 50, 30];
const MIN_GAP_MS = 8_000;
const OFF_COURSE_DEG = 35;
const OFF_COURSE_GAP_MS = 20_000;
const REPEAT_MS = 60_000;

export type VoiceSample = {
  /** Changes when the target does (a new point, the next point of a route). */
  target: string;
  distance: number;
  turn: number | null;
  now: number;
};

/**
 * When to speak: on a new target (its name and the hint), when the distance drops
 * past 1000/500/300/200/100/50/30 m, when the fighter turns away by more than 35°
 * (at most every 20 s), and otherwise once a minute.
 */
export class VoiceCoach {
  private target: string | null = null;
  private lastAt = 0;
  private passed = new Set<number>();

  reset(): void {
    this.target = null;
    this.passed.clear();
  }

  update(s: VoiceSample): string | null {
    if (s.target !== this.target) {
      this.target = s.target;
      this.passed = new Set(MILESTONES.filter((m) => s.distance <= m));
      return this.say(s.now, `${s.target}. ${sayHint(s.distance, s.turn)}`);
    }
    const gap = s.now - this.lastAt;
    const milestone = MILESTONES.find((m) => s.distance <= m && !this.passed.has(m));
    if (milestone != null) {
      for (const m of MILESTONES) if (s.distance <= m) this.passed.add(m);
      if (gap >= MIN_GAP_MS) return this.say(s.now, sayHint(s.distance, s.turn));
    }
    if (s.turn != null && Math.abs(s.turn) > OFF_COURSE_DEG && gap >= OFF_COURSE_GAP_MS) {
      return this.say(s.now, sayHint(s.distance, s.turn));
    }
    if (gap >= REPEAT_MS) return this.say(s.now, sayHint(s.distance, s.turn));
    return null;
  }

  private say(now: number, text: string): string {
    this.lastAt = now;
    return text;
  }
}
