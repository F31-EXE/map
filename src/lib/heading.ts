/** Smallest absolute difference between two compass angles, 0..180. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Low-pass filter for compass readings. Averages unit vectors rather than raw
 * degrees so 359° and 1° average to 0°, not 180°.
 */
export class HeadingSmoother {
  private x = 0;
  private y = 0;
  private primed = false;
  private readonly alpha: number;

  constructor(alpha = 0.25) {
    this.alpha = alpha;
  }

  push(deg: number): number {
    const r = (deg * Math.PI) / 180;
    if (!this.primed) {
      this.x = Math.cos(r);
      this.y = Math.sin(r);
      this.primed = true;
    } else {
      this.x += this.alpha * (Math.cos(r) - this.x);
      this.y += this.alpha * (Math.sin(r) - this.y);
    }
    return ((Math.atan2(this.y, this.x) * 180) / Math.PI + 360) % 360;
  }
}
