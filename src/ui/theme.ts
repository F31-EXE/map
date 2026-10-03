import { Platform } from 'react-native';

export const C = {
  bg: '#090C0B',
  surface: '#111614',
  elevated: '#171E1B',
  /** Translucent fill under BlurView panels floating over the map. */
  glass: 'rgba(14, 19, 17, 0.62)',
  glassStrong: 'rgba(14, 19, 17, 0.86)',
  line: 'rgba(255, 255, 255, 0.08)',
  lineStrong: 'rgba(255, 255, 255, 0.16)',
  text: '#ECF2EE',
  dim: '#8C9A92',
  faint: '#5A6660',
  accent: '#B4E34A',
  accentInk: '#0B0F0C',
  accentSoft: 'rgba(180, 227, 74, 0.14)',
  danger: '#FF4D4D',
  dangerSoft: 'rgba(255, 77, 77, 0.14)',
  warn: '#FFB020',
  info: '#38BDF8',
  online: '#4ADE80',
};

export const F = {
  regular: 'Exo2_500Medium',
  semibold: 'Exo2_600SemiBold',
  bold: 'Exo2_700Bold',
  mono: 'JetBrainsMono_500Medium',
};

export const R = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 };

export const shadow = Platform.select({
  ios: { shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
  default: { elevation: 10 },
});

/** Small-caps label used above values ("КООРДИНАТЫ", "СОСТАВ"…). */
export const eyebrow = {
  fontFamily: F.semibold,
  fontSize: 11,
  letterSpacing: 1.4,
  color: C.dim,
  textTransform: 'uppercase' as const,
};
