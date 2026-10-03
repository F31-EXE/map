import type { MemberStatus } from './types';

export const STATUSES: Record<MemberStatus, { title: string; icon: 'heart-pulse' | 'skull' | 'sleep'; color: string }> = {
  alive: { title: 'Жив', icon: 'heart-pulse', color: '#6CF08A' },
  dead: { title: 'Убит', icon: 'skull', color: '#FF5A4E' },
  afk: { title: 'АФК', icon: 'sleep', color: '#FFB547' },
};

export const STATUS_ORDER: MemberStatus[] = ['alive', 'dead', 'afk'];
