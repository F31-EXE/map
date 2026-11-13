/**
 * Framing a photo in a circle of diameter `d` (screen px): the photo is drawn at
 * `scale` (≥ 1 = just covers the circle) and moved by `x`, `y` (its center relative to
 * the circle's center). Pure math for `AvatarCropper`.
 */
export type Frame = { scale: number; x: number; y: number };

export const MAX_ZOOM = 6;

/** Screen px per photo px at a frame's scale. */
export const pxPerImage = (w: number, h: number, d: number, scale: number) => (d / Math.min(w, h)) * scale;

/** Keeps the zoom in range and the circle fully covered by the photo. */
export function clampFrame(f: Frame, w: number, h: number, d: number): Frame {
  const scale = Math.min(MAX_ZOOM, Math.max(1, f.scale));
  const k = pxPerImage(w, h, d, scale);
  const mx = Math.max(0, (w * k - d) / 2);
  const my = Math.max(0, (h * k - d) / 2);
  return { scale, x: Math.min(mx, Math.max(-mx, f.x)), y: Math.min(my, Math.max(-my, f.y)) };
}

/** The photo square (in photo px) under the circle. */
export function cropRect(f: Frame, w: number, h: number, d: number) {
  const k = pxPerImage(w, h, d, f.scale);
  const side = d / k;
  const cx = w / 2 - f.x / k;
  const cy = h / 2 - f.y / k;
  return { originX: cx - side / 2, originY: cy - side / 2, width: side, height: side };
}
