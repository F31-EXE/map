/**
 * «SQUAD» game mode: logistics, bases and resources. Pure rules, refereed by one tech
 * phone (src/state/game.tsx), tested in test/squadMode.test.ts.
 *
 *   - Each side has a bank in its HQ (`hq` marker): START_RES at the start, BASE_INCOME a
 *     minute, plus MINE_INCOME a minute per mine (`mine`) it holds.
 *   - Fighters carry resources: standing PICKUP_HOLD_MS within PICKUP_RADIUS of their HQ
 *     or a built depot fills their pack up to CARRY (CARRY_DEPOT with a depot built).
 *   - A squad commander (or the side's command post) puts a building site on the map; it
 *     grows by BUILD_RATE per builder every TICK_MS while builders with resources stand
 *     within BUILD_RADIUS; enemies within the radius take DESTROY_RATE each away.
 *   - Enemy buildings stay hidden until an enemy comes within DETECT_RADIUS or a recon
 *     scan (RECON_RADIUS, not under the owner's REB) finds them.
 *   - Air strike (needs a built airfield): STRIKE_RADIUS around a point, STRIKE_WARN_MS
 *     after the order; buildings there are gone (their resources burn), mines turn
 *     neutral and can't be taken for MINE_BLOCK_MS.
 *   - Score = bank + resources in standing buildings (sites included).
 */
import { distanceMeters } from './geo';
import type { LatLng } from './types';

export const START_RES = 200;
export const BASE_INCOME = 2;
export const MINE_INCOME = 10;
export const CARRY = 50;
export const CARRY_DEPOT = 90;
export const PICKUP_RADIUS = 15;
export const PICKUP_HOLD_MS = 10_000;
export const BUILD_RADIUS = 15;
/** One referee pass; building and destroying go by these steps. */
export const TICK_MS = 5000;
export const BUILD_RATE = 1;
export const DESTROY_RATE = 2;
export const DETECT_RADIUS = 50;
export const HQ_EXCLUSION = 200;
export const MINE_RADIUS = 20;
export const MINE_HOLD_MS = 90_000;
export const MINE_BLOCK_MS = 3 * 60_000;
export const REB_RADIUS = 200;
export const RECON_RADIUS = 150;
export const STRIKE_RADIUS = 50;
export const STRIKE_WARN_MS = 30_000;
export const COOLDOWN_MS = 5 * 60_000;

export type BuildingKind = 'b-fob' | 'b-reb' | 'b-recon' | 'b-air' | 'b-depot';

export const BUILDINGS: Record<BuildingKind, { title: string; short: string; cost: number; text: string }> = {
  'b-fob': { title: 'ФОБ (передовой пункт)', short: 'ФОБ', cost: 300, text: 'Точка респавна стороны на передовой.' },
  'b-reb': { title: 'РЭБ (глушилка)', short: 'РЭБ', cost: 150, text: `Прячет бойцов и постройки стороны в радиусе ${REB_RADIUS} м от вражеской разведки.` },
  'b-recon': { title: 'Пункт разведки', short: 'РАЗВ', cost: 300, text: `Штаб сканирует любую точку: постройки и бойцы врага в радиусе ${RECON_RADIUS} м. Раз в 5 мин.` },
  'b-air': { title: 'ВВП (авиаудар)', short: 'ВВП', cost: 500, text: `Авиаудар по площади ${STRIKE_RADIUS} м с предупреждением за 30 с. Раз в 5 мин.` },
  'b-depot': { title: 'Склад (логистический узел)', short: 'СКЛАД', cost: 250, text: `Пополнение рядом и перенос до ${CARRY_DEPOT} вместо ${CARRY}.` },
};

export const BUILDING_KINDS = Object.keys(BUILDINGS) as BuildingKind[];

export const isBuilding = (kind: string): kind is BuildingKind => kind in BUILDINGS;

/** Building state, stored on its game marker. */
export type Bld = {
  cost: number;
  /** Resources in it so far (a site until paid ≥ cost). */
  paid: number;
  built: boolean;
  /** Enemy sides that have found it (it shows on their map). */
  seen: string[];
  /** Recon / airfield: ready again after this moment. */
  ready?: number | null;
};

export type Site = { id: string; kind: BuildingKind; owner: string; lat: number; lng: number; bld: Bld };
export type Fighter = { uid: string; sideId: string; lat: number; lng: number };

const near = (a: LatLng, b: LatLng, r: number) => distanceMeters(a, b) <= r;

/** Pack size of a side's fighters: bigger once it has a depot standing. */
export function carryLimit(sideId: string, sites: Site[]): number {
  return sites.some((s) => s.owner === sideId && s.kind === 'b-depot' && s.bld.built) ? CARRY_DEPOT : CARRY;
}

/** Why a building can't go here, or null: not within HQ_EXCLUSION of any HQ. */
export function placeError(at: LatLng, hqs: { lat: number; lng: number }[]): string | null {
  const close = hqs.find((h) => near(at, h, HQ_EXCLUSION));
  if (close) return `Ближе ${HQ_EXCLUSION} м к штабу строить нельзя (${Math.round(distanceMeters(at, close))} м).`;
  return null;
}

/** Points where a fighter of `sideId` fills their pack: own HQ and own built depots. */
export function supplyPoints(sideId: string, hqs: { owner: string; lat: number; lng: number }[], sites: Site[]): LatLng[] {
  return [
    ...hqs.filter((h) => h.owner === sideId),
    ...sites.filter((s) => s.owner === sideId && s.kind === 'b-depot' && s.bld.built),
  ];
}

/**
 * Pickup: fighters who have stood at a supply point for PICKUP_HOLD_MS get their pack
 * filled from the side's bank. `since` (uid → first tick seen there) is kept by the
 * caller between ticks and updated here. Returns new carries and bank changes.
 */
export function pickups(
  fighters: Fighter[],
  carry: Record<string, number>,
  bank: Record<string, number>,
  hqs: { owner: string; lat: number; lng: number }[],
  sites: Site[],
  since: Map<string, number>,
  now: number
): { carry: Record<string, number>; bank: Record<string, number> } {
  const nextCarry: Record<string, number> = {};
  const nextBank = { ...bank };
  const here = new Set<string>();
  for (const f of fighters) {
    const pts = supplyPoints(f.sideId, hqs, sites);
    if (!pts.some((p) => near(f, p, PICKUP_RADIUS))) continue;
    here.add(f.uid);
    const t0 = since.get(f.uid) ?? now;
    since.set(f.uid, t0);
    if (now - t0 < PICKUP_HOLD_MS) continue;
    const have = carry[f.uid] ?? 0;
    const room = carryLimit(f.sideId, sites) - have;
    const take = Math.max(0, Math.min(room, nextBank[f.sideId] ?? 0));
    if (take <= 0) continue;
    nextCarry[f.uid] = have + take;
    nextBank[f.sideId] = (nextBank[f.sideId] ?? 0) - take;
  }
  for (const uid of [...since.keys()]) if (!here.has(uid)) since.delete(uid);
  return { carry: nextCarry, bank: nextBank };
}

/**
 * One tick of building and wrecking. Builders (own side, resources in the pack) add
 * BUILD_RATE each; enemies take DESTROY_RATE each (they need no resources). Returns the
 * changed sites, the sites wrecked to nothing, and the builders' new packs.
 */
export function buildTick(
  sites: Site[],
  fighters: Fighter[],
  carry: Record<string, number>
): { changed: Site[]; wrecked: string[]; carry: Record<string, number> } {
  const packs: Record<string, number> = {};
  const changed: Site[] = [];
  const wrecked: string[] = [];
  for (const s of sites) {
    let paid = s.bld.paid;
    const around = fighters.filter((f) => near(f, s, BUILD_RADIUS));
    const enemies = around.filter((f) => f.sideId !== s.owner).length;
    if (enemies) paid -= DESTROY_RATE * enemies;
    if (!s.bld.built && !enemies) {
      for (const f of around) {
        if (f.sideId !== s.owner || paid >= s.bld.cost) continue;
        const have = packs[f.uid] ?? carry[f.uid] ?? 0;
        if (have <= 0) continue;
        const put = Math.min(BUILD_RATE, have, s.bld.cost - paid);
        packs[f.uid] = have - put;
        paid += put;
      }
    }
    if (paid <= 0 && enemies) {
      wrecked.push(s.id);
      continue;
    }
    const built = s.bld.built || paid >= s.bld.cost;
    if (paid !== s.bld.paid || built !== s.bld.built) {
      changed.push({ ...s, bld: { ...s.bld, paid: Math.max(0, Math.min(paid, s.bld.cost)), built } });
    }
  }
  return { changed, wrecked, carry: packs };
}

/** Points where a side's REB covers its own fighters and buildings. */
export function jammed(sideId: string, at: LatLng, sites: Site[]): boolean {
  return sites.some((s) => s.owner === sideId && s.kind === 'b-reb' && s.bld.built && near(at, s, REB_RADIUS));
}

/** Enemy buildings an enemy fighter has come close to: side → ids newly seen. */
export function detections(sites: Site[], fighters: Fighter[]): { id: string; side: string }[] {
  const out: { id: string; side: string }[] = [];
  for (const s of sites) {
    const seen = new Set(s.bld.seen);
    for (const f of fighters) {
      if (f.sideId === s.owner || seen.has(f.sideId)) continue;
      if (near(f, s, DETECT_RADIUS)) {
        seen.add(f.sideId);
        out.push({ id: s.id, side: f.sideId });
      }
    }
  }
  return out;
}

/** A recon scan by `sideId` at `at`: enemy buildings and fighters found (REB hides them). */
export function reconScan(
  sideId: string,
  at: LatLng,
  sites: Site[],
  fighters: Fighter[]
): { sites: string[]; fighters: LatLng[] } {
  const found = sites.filter((s) => s.owner !== sideId && near(s, at, RECON_RADIUS) && !jammed(s.owner, s, sites));
  const people = fighters.filter((f) => f.sideId !== sideId && near(f, at, RECON_RADIUS) && !jammed(f.sideId, f, sites));
  return { sites: found.map((s) => s.id), fighters: people.map((f) => ({ lat: f.lat, lng: f.lng })) };
}

/** What an air strike at `at` hits: building ids (any side) and mine ids. */
export function strikeHits(
  at: LatLng,
  sites: Site[],
  mines: { id: string; lat: number; lng: number }[]
): { sites: string[]; mines: string[] } {
  return {
    sites: sites.filter((s) => near(s, at, STRIKE_RADIUS)).map((s) => s.id),
    mines: mines.filter((m) => near(m, at, STRIKE_RADIUS)).map((m) => m.id),
  };
}

/** A side's ability (recon / strike) is ready: a built building of that kind, not cooling down. */
export function abilityReady(sideId: string, kind: 'b-recon' | 'b-air', sites: Site[], now: number): Site | null {
  return (
    sites.find((s) => s.owner === sideId && s.kind === kind && s.bld.built && (s.bld.ready ?? 0) <= now) ?? null
  );
}

/** Mine capture: the side with strictly more live fighters within MINE_RADIUS for MINE_HOLD_MS. */
export function mineStep(
  mine: { lat: number; lng: number; owner: string | null; mcap?: { s: string; t: number } | null; block?: number | null },
  fighters: Fighter[],
  now: number
): { owner: string | null; mcap: { s: string; t: number } | null; captured: boolean } {
  const cur = mine.mcap ?? null;
  if (mine.block && now < mine.block) return { owner: mine.owner, mcap: null, captured: false };
  const count = new Map<string, number>();
  for (const f of fighters) if (near(f, mine, MINE_RADIUS)) count.set(f.sideId, (count.get(f.sideId) ?? 0) + 1);
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]);
  const leader = ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null;
  if (!leader || leader === mine.owner) return { owner: mine.owner, mcap: null, captured: false };
  const since = cur && cur.s === leader ? cur : { s: leader, t: now };
  if (now - since.t >= MINE_HOLD_MS) return { owner: leader, mcap: null, captured: true };
  return { owner: mine.owner, mcap: since, captured: false };
}

/** Income for one minute: base + per mine held. */
export function minuteIncome(sideIds: string[], mines: { owner?: string | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sideIds) out[s] = BASE_INCOME + MINE_INCOME * mines.filter((m) => m.owner === s).length;
  return out;
}

/** Score: bank + resources in standing buildings. */
export function squadScore(sideIds: string[], bank: Record<string, number>, sites: Site[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sideIds) {
    out[s] = (bank[s] ?? 0) + sites.filter((x) => x.owner === s).reduce((n, x) => n + x.bld.paid, 0);
  }
  return out;
}

/** Leaders by score (several on a draw). */
export function squadWinners(score: Record<string, number>): string[] {
  const best = Math.max(...Object.values(score));
  if (!Number.isFinite(best)) return [];
  return Object.keys(score).filter((s) => score[s] === best);
}
