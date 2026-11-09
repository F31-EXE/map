import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { useNight } from '../state/night';

/**
 * Night mode: multiplies everything under it by deep red, so whites turn red, greens go
 * dark and nothing glows blue-white (keeps night vision, doesn't light you up). Put it
 * last in a screen or modal; it lets touches through.
 */
export function NightFilter() {
  const night = useNight();
  useEffect(() => {
    // React Native Web has no blend modes: filter the whole page instead.
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.style.filter = night ? 'grayscale(1) sepia(1) saturate(9) hue-rotate(-50deg) brightness(0.7)' : '';
  }, [night]);
  if (!night || Platform.OS === 'web') return null;
  return <View pointerEvents="none" style={styles.filter} />;
}

const styles = StyleSheet.create({
  filter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#D81000', mixBlendMode: 'multiply' },
});
