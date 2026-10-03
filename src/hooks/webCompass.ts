/**
 * Compass for the web version on phones, where expo-location has no heading.
 * Android Chrome fires `deviceorientationabsolute` (alpha counts counter-clockwise
 * from north); iOS Safari gives `webkitCompassHeading`, but only after
 * DeviceOrientationEvent.requestPermission() from a user tap, so the first tap
 * anywhere on the page asks for it.
 */
type IosOrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };
type IosPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

export function watchWebCompass(onHeading: (deg: number) => void): () => void {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return () => {};

  // Heading is relative to the device top; correct for a rotated screen.
  const screenAngle = () => (typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : 0);

  const onAbsolute = (e: DeviceOrientationEvent) => {
    if (e.alpha == null) return;
    onHeading((360 - e.alpha + screenAngle()) % 360);
  };
  const onIos = (e: DeviceOrientationEvent) => {
    const h = (e as IosOrientationEvent).webkitCompassHeading;
    if (typeof h === 'number' && h >= 0) onHeading((h + screenAngle()) % 360);
  };

  window.addEventListener('deviceorientationabsolute', onAbsolute as EventListener);
  window.addEventListener('deviceorientation', onIos);

  const ask = (DeviceOrientationEvent as unknown as IosPermission).requestPermission;
  const onTap = () => {
    window.removeEventListener('click', onTap);
    ask?.().catch(() => {});
  };
  if (ask) window.addEventListener('click', onTap);

  return () => {
    window.removeEventListener('deviceorientationabsolute', onAbsolute as EventListener);
    window.removeEventListener('deviceorientation', onIos);
    window.removeEventListener('click', onTap);
  };
}
