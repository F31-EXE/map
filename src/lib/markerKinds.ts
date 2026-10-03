import {
  mdiAccountTie,
  mdiAlert,
  mdiAutorenew,
  mdiArrowTopRightThick,
  mdiFlagVariant,
  mdiMapMarkerRadius,
  mdiMedicalBag,
  mdiNoteText,
  mdiParking,
  mdiRunFast,
  mdiShield,
  mdiShieldHalfFull,
  mdiSkullCrossbones,
  mdiSwordCross,
  mdiTarget,
} from '@mdi/js';

import type { AdminKind, MarkerKind, OrderKind } from './types';

type KindDef = {
  title: string;
  /** MaterialCommunityIcons glyph name, for the RN UI. */
  icon:
    | 'target'
    | 'shield'
    | 'flag-variant'
    | 'alert'
    | 'map-marker-radius'
    | 'medical-bag'
    | 'note-text'
    | 'run-fast'
    | 'sword-cross'
    | 'shield-half-full'
    | 'arrow-top-right-thick'
    | 'autorenew'
    | 'skull-crossbones'
    | 'parking'
    | 'account-tie';
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
  arrow: { title: 'Стрелка', icon: 'arrow-top-right-thick', path: mdiArrowTopRightThick, color: '#FFC83D' },
  respawn: { title: 'Респ', icon: 'autorenew', path: mdiAutorenew, color: '#2EE6C5' },
  deadzone: { title: 'Мертвяк', icon: 'skull-crossbones', path: mdiSkullCrossbones, color: '#C3CCC6' },
  parking: { title: 'Парковка', icon: 'parking', path: mdiParking, color: '#7FA7FF' },
  admin: { title: 'Администрация', icon: 'account-tie', path: mdiAccountTie, color: '#F2F2F2' },
  'order-move': { title: 'Двигаться сюда', icon: 'run-fast', path: mdiRunFast, color: '#B4E34A' },
  'order-attack': { title: 'Атаковать', icon: 'sword-cross', path: mdiSwordCross, color: '#FF4D4D' },
  'order-defend': { title: 'Оборонять', icon: 'shield-half-full', path: mdiShieldHalfFull, color: '#3D9BFF' },
};

/** Orders: only commanders may place them, and teammates get a buzz + sound. */
export const ORDER_KINDS: OrderKind[] = ['order-move', 'order-attack', 'order-defend'];

export function isOrder(kind: MarkerKind): kind is OrderKind {
  return (ORDER_KINDS as string[]).includes(kind);
}

/** Polygon infrastructure: respawn, dead zone, parking, organizers. */
export const ADMIN_KINDS: AdminKind[] = ['respawn', 'deadzone', 'parking', 'admin'];

export function isAdminKind(kind: MarkerKind): kind is AdminKind {
  return (ADMIN_KINDS as string[]).includes(kind);
}

export const MARKER_KIND_ORDER: MarkerKind[] = [
  'enemy',
  'friendly',
  'objective',
  'danger',
  'rally',
  'medic',
  'note',
];

/**
 * Votes needed to hide a marker ("no longer relevant" or "done"): three, or the whole
 * squad when it is smaller than that.
 */
export function voteThreshold(squadSize: number): number {
  return Math.max(1, Math.min(3, squadSize));
}

export function isVotedOut(m: { staleVotes?: string[]; doneVotes?: string[] }, squadSize: number): boolean {
  const n = voteThreshold(squadSize);
  return (m.staleVotes?.length ?? 0) >= n || (m.doneVotes?.length ?? 0) >= n;
}
