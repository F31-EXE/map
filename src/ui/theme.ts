import { Platform } from 'react-native';

/** Night-vision green tactical palette. */
export const C = {
  bg: '#050A07',
  surface: '#0A140E',
  elevated: '#0F1E15',
  /** Translucent fill under BlurView panels floating over the map. */
  glass: 'rgba(6, 14, 10, 0.70)',
  glassStrong: 'rgba(6, 14, 10, 0.90)',
  line: 'rgba(120, 230, 140, 0.13)',
  lineStrong: 'rgba(120, 230, 140, 0.30)',
  text: '#DCF7E0',
  dim: '#86AE90',
  faint: '#4D6D56',
  accent: '#8EF07A',
  accentInk: '#04100A',
  accentSoft: 'rgba(142, 240, 122, 0.14)',
  /** Soft glow behind active elements. */
  glow: 'rgba(142, 240, 122, 0.45)',
  danger: '#FF5A4E',
  dangerSoft: 'rgba(255, 90, 78, 0.15)',
  warn: '#FFB547',
  warnSoft: 'rgba(255, 181, 71, 0.14)',
  info: '#5CC8FF',
  online: '#6CF08A',
};

export const F = {
  regular: 'Exo2_500Medium',
  semibold: 'Exo2_600SemiBold',
  bold: 'Exo2_700Bold',
  mono: 'JetBrainsMono_500Medium',
};

export const R = { sm: 6, md: 8, lg: 10, xl: 14, pill: 999 };

export const shadow = Platform.select({
  ios: { shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  default: { elevation: 8 },
});

/** Small-caps label used above values ("КООРДИНАТЫ", "СОСТАВ"…). */
export const eyebrow = {
  fontFamily: F.mono,
  fontSize: 11,
  letterSpacing: 1.2,
  color: C.dim,
  textTransform: 'uppercase' as const,
};
