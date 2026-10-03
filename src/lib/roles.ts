import { mdiChevronDoubleUp, mdiCrosshairs, mdiPlusThick, mdiStar } from '@mdi/js';

/**
 * Squad-style role glyphs. Rifle and machine gun are custom silhouettes (Material
 * has no firearms beyond a pistol); the rest are Material Design Icons paths.
 * All paths use a 24×24 viewBox and render as a single fill.
 */
const RIFLE =
  'M1 9.6L5 9.4V13L1.6 14.4Z M5 9H15V12H5Z M15 9.6H19.2V11.6H15Z M19.2 10.1H23V10.9H19.2Z ' +
  'M9.6 12H11.9L13.1 16.6L11.1 17.2Z M6.4 12H8.4L7.7 15.6H5.9Z M11 8H13.2V9H11Z';

const MACHINE_GUN =
  'M1 9.4L5 9.2V12.6L1.4 13.8Z M5 8.6H16V11.6H5Z M16 9.4H23V10.4H16Z M8.5 11.6H12.5V15.6H8.5Z ' +
  'M6 11.6H7.8L7.2 14.8H5.5Z M17.5 10.4L16 15.5H17L18.3 10.4Z M19.2 10.4L20.6 15.5H21.6L20.2 10.4Z';

export type RoleId = 'commander' | 'sergeant' | 'rifleman' | 'machinegunner' | 'sniper' | 'medic';

export const ROLES: Record<RoleId, { title: string; short: string; path: string }> = {
  commander: { title: 'Командир', short: 'КМД', path: mdiStar },
  sergeant: { title: 'Старшина', short: 'СТ', path: mdiChevronDoubleUp },
  rifleman: { title: 'Автоматчик', short: 'АВТ', path: RIFLE },
  machinegunner: { title: 'Пулемётчик', short: 'ПУЛ', path: MACHINE_GUN },
  sniper: { title: 'Снайпер', short: 'СНП', path: mdiCrosshairs },
  medic: { title: 'Медик', short: 'МЕД', path: mdiPlusThick },
};

export const ROLE_ORDER: RoleId[] = ['commander', 'sergeant', 'rifleman', 'machinegunner', 'sniper', 'medic'];

export const DEFAULT_ROLE: RoleId = 'rifleman';

export function roleOf(id: unknown): RoleId {
  return typeof id === 'string' && id in ROLES ? (id as RoleId) : DEFAULT_ROLE;
}

/** Colors the team commander can pick; every teammate is drawn in it. */
export const TEAM_COLORS = [
  '#4ADE80',
  '#3D9BFF',
  '#FF4D4D',
  '#FFC83D',
  '#B79CFF',
  '#FF8A3D',
  '#22D3EE',
  '#F5F5F5',
];

export const DEFAULT_TEAM_COLOR = TEAM_COLORS[0];
