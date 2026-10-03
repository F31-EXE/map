import {
  mdiAlert,
  mdiFlagVariant,
  mdiMapMarkerRadius,
  mdiMedicalBag,
  mdiNoteText,
  mdiShield,
  mdiTarget,
} from '@mdi/js';

import type { MarkerKind } from './types';

type KindDef = {
  title: string;
  /** MaterialCommunityIcons glyph name, for the RN UI. */
  icon: 'target' | 'shield' | 'flag-variant' | 'alert' | 'map-marker-radius' | 'medical-bag' | 'note-text';
  /** Same icon as an SVG path, for markers drawn inside the map WebView. */
  path: string;
  color: string;
};

export const MARKER_KINDS: Record<MarkerKind, KindDef> = {
  enemy: { title: 'Противник', icon: 'target', path: mdiTarget, color: '#FF4D4D' },
  friendly: { title: 'Свои', icon: 'shield', path: mdiShield, color: '#3D9BFF' },
  objective: { title: 'Цель', icon: 'flag-variant', path: mdiFlagVariant, color: '#FFC83D' },
  danger: { title: 'Опасность', icon: 'alert', path: mdiAlert, color: '#FF8A3D' },
  rally: { title: 'Сбор', icon: 'map-marker-radius', path: mdiMapMarkerRadius, color: '#4ADE80' },
  medic: { title: 'Медик', icon: 'medical-bag', path: mdiMedicalBag, color: '#F472B6' },
  note: { title: 'Заметка', icon: 'note-text', path: mdiNoteText, color: '#B79CFF' },
};

export const MARKER_KIND_ORDER: MarkerKind[] = [
  'enemy',
  'friendly',
  'objective',
  'danger',
  'rally',
  'medic',
  'note',
];

export const MEMBER_COLORS = [
  '#4ADE80',
  '#3D9BFF',
  '#FFC83D',
  '#FF8A3D',
  '#B79CFF',
  '#22D3EE',
  '#F472B6',
  '#A3E635',
];
