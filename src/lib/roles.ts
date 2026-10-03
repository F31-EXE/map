/**
 * Role badges in the spirit of Squad's kit icons, drawn from scratch: a frame
 * (shield for leaders and support, diamond for fighters) around a glyph. All
 * paths use a 24×24 viewBox and render as a single fill; frames use evenodd.
 */

/** Mirrors (flip)/rotates/scales/moves a path made only of absolute M, L, C and Z commands. */
function xf(path: string, { rotate = 0, scale = 1, dx = 0, dy = 0, flip = false }): string {
  const a = (rotate * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const r = (n: number) => Math.round(n * 100) / 100;
  return path.replace(/(-?\d*\.?\d+)[ ,]+(-?\d*\.?\d+)/g, (_m, xs: string, ys: string) => {
    const x = (Number(xs) - 12) * scale * (flip ? -1 : 1);
    const y = (Number(ys) - 12) * scale;
    return `${r(12 + dx + x * cos - y * sin)} ${r(12 + dy + x * sin + y * cos)}`;
  });
}

const RIFLE =
  'M1 9.6L5 9.4L5 13L1.6 14.4Z M5 9L15 9L15 12L5 12Z M15 9.6L19.2 9.6L19.2 11.6L15 11.6Z ' +
  'M19.2 10.1L23 10.1L23 10.9L19.2 10.9Z M9.6 12L11.9 12L13.1 16.6L11.1 17.2Z ' +
  'M6.4 12L8.4 12L7.7 15.6L5.9 15.6Z M11 8L13.2 8L13.2 9L11 9Z';

const MACHINE_GUN =
  'M1 9.4L5 9.2L5 12.6L1.4 13.8Z M5 8.6L16 8.6L16 11.6L5 11.6Z M16 9.4L23 9.4L23 10.4L16 10.4Z ' +
  'M8.5 11.6L12.5 11.6L12.5 15.6L8.5 15.6Z M6 11.6L7.8 11.6L7.2 14.8L5.5 14.8Z';

const SHOVEL =
  'M9.8 4.5L14.2 4.5L14.2 6.3L9.8 6.3Z M11.3 6.3L12.7 6.3L12.7 12.5L11.3 12.5Z ' +
  'M9.5 12.5L14.5 12.5L14.5 16.3C14.5 17.9 13.3 19 12 19.6C10.7 19 9.5 17.9 9.5 16.3Z';

const FRAMES = {
  diamond: 'M12 0.8L23.2 12L12 23.2L0.8 12Z M12 3.6L3.6 12L12 20.4L20.4 12Z',
  shield:
    'M3 1.8L21 1.8L21 12C21 17.4 17 20.9 12 23C7 20.9 3 17.4 3 12Z ' +
    'M5.3 4.1L5.3 12C5.3 16 8.2 18.8 12 20.5C15.8 18.8 18.7 16 18.7 12L18.7 4.1Z',
};

export type RoleFrame = keyof typeof FRAMES;

const GLYPHS = {
  commander:
    'M6.5 8.6L12 5.4L17.5 8.6L17.5 10.8L12 7.6L6.5 10.8Z M6.5 12.1L12 8.9L17.5 12.1L17.5 14.3L12 11.1L6.5 14.3Z ' +
    'M6.5 15.6L12 12.4L17.5 15.6L17.5 17.6L12 14.6L6.5 17.6Z',
  sergeant: 'M6.5 9.2L12 6L17.5 9.2L17.5 11.4L12 8.2L6.5 11.4Z M6.5 13.2L12 10L17.5 13.2L17.5 15.4L12 12.2L6.5 15.4Z',
  rifleman: xf(RIFLE, { rotate: -38, scale: 0.8 }),
  machinegunner:
    xf(MACHINE_GUN + ' M17.5 10.4L16 15.5L17 15.5L18.3 10.4Z M19.2 10.4L20.6 15.5L21.6 15.5L20.2 10.4Z', {
      rotate: -38,
      scale: 0.8,
      dy: -1.6,
    }) + ' M9.6 16.4L10.6 16.4L10.6 19L9.6 19Z M11.5 16.4L12.5 16.4L12.5 19L11.5 19Z M13.4 16.4L14.4 16.4L14.4 19L13.4 19Z',
  grenadier:
    'M12 9C15 9 16 11.5 16 14C16 16.8 14.2 18.6 12 18.6C9.8 18.6 8 16.8 8 14C8 11.5 9 9 12 9Z ' +
    'M9.4 12.4L9.4 13.1L14.6 13.1L14.6 12.4Z M9.2 15.1L9.2 15.8L14.8 15.8L14.8 15.1Z ' +
    'M10.8 6.8L13.2 6.8L13.2 9L10.8 9Z M13.2 6.9L16 8.2L15.6 9L13.2 8.1Z',
  launcher:
    'M7 11.1L14.2 11.1L14.2 12.9L7 12.9Z M14.2 10.2L16.2 10.2L18.4 12L16.2 13.8L14.2 13.8Z ' +
    'M6 9.4L8.8 11.1L6 11.1Z M6 14.6L8.8 12.9L6 12.9Z',
  sniper:
    'M12 7.6C14.4 7.6 16.4 9.6 16.4 12C16.4 14.4 14.4 16.4 12 16.4C9.6 16.4 7.6 14.4 7.6 12C7.6 9.6 9.6 7.6 12 7.6Z ' +
    'M12 9.6C10.7 9.6 9.6 10.7 9.6 12C9.6 13.3 10.7 14.4 12 14.4C13.3 14.4 14.4 13.3 14.4 12C14.4 10.7 13.3 9.6 12 9.6Z ' +
    'M12 11C12.6 11 13 11.4 13 12C13 12.6 12.6 13 12 13C11.4 13 11 12.6 11 12C11 11.4 11.4 11 12 11Z ' +
    'M10.6 4.6L13.4 4.6L12 7.2Z M10.6 19.4L13.4 19.4L12 16.8Z M4.6 10.6L4.6 13.4L7.2 12Z M19.4 10.6L19.4 13.4L16.8 12Z',
  scout:
    'M7.4 8.2L10.7 8.2L11.1 16.6L6.8 16.6Z M13.3 8.2L16.6 8.2L17.2 16.6L12.9 16.6Z ' +
    'M10.7 10.2L13.3 10.2L13.3 12.6L10.7 12.6Z M7.9 6.6L10.3 6.6L10.3 8.2L7.9 8.2Z M13.7 6.6L16.1 6.6L16.1 8.2L13.7 8.2Z',
  raider:
    'M10.9 13L10.9 7C10.9 5.9 11.4 5.1 12.1 4.6C13.2 5.8 13.5 8.4 13.2 13Z ' +
    'M9 13L15 13L15 14.3L9 14.3Z M11 14.3L13 14.3L13 18.8L11 18.8Z',
  engineer: xf(SHOVEL, { rotate: 35, scale: 0.85, dy: -0.4 }),
  medic: 'M10.3 6.6L13.7 6.6L13.7 10.3L17.4 10.3L17.4 13.7L13.7 13.7L13.7 17.4L10.3 17.4L10.3 13.7L6.6 13.7L6.6 10.3L10.3 10.3Z',
  radio:
    'M8.5 9L15.5 9L15.5 18.4L8.5 18.4Z M10 10.5L10 13L14 13L14 10.5Z ' +
    'M13.4 4.4L14.5 4.4L14.5 9L13.4 9Z M10 14.6L11.2 14.6L11.2 15.8L10 15.8Z M12.8 14.6L14 14.6L14 15.8L12.8 15.8Z',
};

export type RoleId = keyof typeof GLYPHS;

type RoleDef = { title: string; short: string; frame: RoleFrame; path: string };

const def = (title: string, short: string, frame: RoleFrame, id: RoleId): RoleDef => ({
  title,
  short,
  frame,
  path: GLYPHS[id],
});

export const ROLES: Record<RoleId, RoleDef> = {
  commander: def('Командир', 'КМД', 'shield', 'commander'),
  sergeant: def('Старшина', 'СТ', 'shield', 'sergeant'),
  rifleman: def('Автоматчик', 'АВТ', 'diamond', 'rifleman'),
  machinegunner: def('Пулемётчик', 'ПУЛ', 'diamond', 'machinegunner'),
  grenadier: def('Гренадёр', 'ГРН', 'diamond', 'grenadier'),
  launcher: def('Гранатомётчик', 'РПГ', 'diamond', 'launcher'),
  sniper: def('Снайпер', 'СНП', 'diamond', 'sniper'),
  scout: def('Разведчик', 'РЗВ', 'diamond', 'scout'),
  raider: def('Штурмовик', 'ШТМ', 'diamond', 'raider'),
  engineer: def('Сапёр', 'САП', 'shield', 'engineer'),
  medic: def('Медик', 'МЕД', 'shield', 'medic'),
  radio: def('Связист', 'СВЗ', 'diamond', 'radio'),
};

/** Frame outline for a role badge (evenodd). */
export function roleFrame(id: RoleId): string {
  return FRAMES[ROLES[id].frame];
}

export const ROLE_ORDER: RoleId[] = [
  'commander',
  'sergeant',
  'rifleman',
  'machinegunner',
  'grenadier',
  'launcher',
  'sniper',
  'scout',
  'raider',
  'engineer',
  'medic',
  'radio',
];

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
