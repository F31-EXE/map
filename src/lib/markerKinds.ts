import type { MarkerKind } from './types';

export const MARKER_KINDS: Record<MarkerKind, { title: string; symbol: string; color: string }> = {
  enemy: { title: 'Противник', symbol: '✖', color: '#e53935' },
  friendly: { title: 'Свои', symbol: '◆', color: '#1e88e5' },
  objective: { title: 'Цель / точка', symbol: '★', color: '#fdd835' },
  danger: { title: 'Опасность / мина', symbol: '⚠', color: '#fb8c00' },
  rally: { title: 'Точка сбора', symbol: '⚑', color: '#43a047' },
  medic: { title: 'Медик / респаун', symbol: '✚', color: '#ffffff' },
  note: { title: 'Заметка', symbol: '✎', color: '#8e24aa' },
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
  '#43a047',
  '#1e88e5',
  '#fdd835',
  '#e53935',
  '#8e24aa',
  '#fb8c00',
  '#00acc1',
  '#d81b60',
];
