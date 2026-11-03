import { CALENDAR_BASE, toCalendarGame, upcomingWithMap, type CalendarGame, type FsDoc } from '../lib/calendar';

/** One game of the THE GRIM TEAM calendar by id. */
export async function fetchCalendarGame(id: string): Promise<CalendarGame> {
  const res = await fetch(`${CALENDAR_BASE}/games/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new Error('Игра не найдена в календаре');
  if (!res.ok) throw new Error(`Календарь недоступен (HTTP ${res.status})`);
  return toCalendarGame((await res.json()) as FsDoc);
}

/** Upcoming calendar games that have a polygon map, points or coordinates. */
export async function fetchUpcomingGames(): Promise<CalendarGame[]> {
  const res = await fetch(`${CALENDAR_BASE}/games?pageSize=300`);
  if (!res.ok) throw new Error(`Календарь недоступен (HTTP ${res.status})`);
  const json = (await res.json()) as { documents?: FsDoc[] };
  return upcomingWithMap((json.documents ?? []).map(toCalendarGame));
}
