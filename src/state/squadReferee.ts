import { useEffect, useRef } from 'react';

import { matchState, type Match } from '../lib/gameModes';
import {
  abilityReady,
  buildTick,
  COOLDOWN_MS,
  detections,
  isBuilding,
  MINE_BLOCK_MS,
  mineStep,
  minuteIncome,
  pickups,
  reconScan,
  strikeHits,
  STRIKE_WARN_MS,
  TICK_MS,
  type Bld,
  type Fighter,
  type Site,
} from '../lib/squadMode';
import type { GamePlayer, GameSide, TacMarker } from '../lib/types';
import * as games from '../services/games';

/** Packs, banks and building progress go to the server at most this often (except events). */
const FLUSH_MS = 15_000;
/** Done strikes and scans stay on the map this long, then the referee clears them. */
const HIT_KEEP_MS = 2 * 60_000;

export function sitesOf(markers: TacMarker[], bldOverride?: Map<string, Bld>): Site[] {
  const out: Site[] = [];
  for (const m of markers) {
    if (!isBuilding(m.kind) || !m.owner || !m.bld) continue;
    out.push({ id: m.id, kind: m.kind, owner: m.owner, lat: m.lat, lng: m.lng, bld: bldOverride?.get(m.id) ?? m.bld });
  }
  return out;
}

/**
 * SQUAD referee, run by one tech phone while a match runs: income, packs, building and
 * wrecking, finding buildings, mines, air strikes and recon scans. It keeps packs, banks
 * and building progress in memory (it is their only writer) and writes them every 15 s,
 * or at once for what players should see right away (a full pack, a finished or wrecked
 * building, a find, a strike).
 */
export function useSquadReferee(p: {
  active: boolean;
  gameId: string | null;
  match: Match | null;
  markers: TacMarker[];
  sides: GameSide[];
  players: GamePlayer[];
  fighters: () => Fighter[];
}) {
  const markersRef = useRef(p.markers);
  markersRef.current = p.markers;
  const sidesRef = useRef(p.sides);
  sidesRef.current = p.sides;
  const playersRef = useRef(p.players);
  playersRef.current = p.players;
  const fightersRef = useRef(p.fighters);
  fightersRef.current = p.fighters;

  const hasSquad = p.markers.some((m) => m.kind === 'hq');
  const { active, gameId, match } = p;

  useEffect(() => {
    if (!active || !gameId || !match || !hasSquad) return;
    const carryM = new Map<string, number>();
    const bankM = new Map<string, number>();
    const bldM = new Map<string, Bld>();
    const dirty = { carry: new Set<string>(), bank: new Set<string>(), bld: new Set<string>() };
    const since = new Map<string, number>();
    const accepted = new Set<string>();
    let lastFlush = Date.now();
    // Income is paid for whole minutes from here on (a referee taking over doesn't pay twice).
    let paidMinute = Math.floor((Date.now() - match.start) / 60_000);

    const carryOf = (uid: string) => carryM.get(uid) ?? playersRef.current.find((x) => x.uid === uid)?.carry ?? 0;
    const bankOf = (side: string) => bankM.get(side) ?? sidesRef.current.find((s) => s.id === side)?.res ?? 0;

    const flush = (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastFlush < FLUSH_MS) return;
      lastFlush = now;
      for (const uid of dirty.carry) games.setCarry(gameId, uid, carryM.get(uid) ?? 0).catch(() => {});
      for (const s of dirty.bank) games.setSideRes(gameId, s, bankM.get(s) ?? 0).catch(() => {});
      for (const id of dirty.bld) {
        const b = bldM.get(id);
        if (b) games.updateGameMarker(gameId, id, { bld: b }).catch(() => {});
      }
      dirty.carry.clear();
      dirty.bank.clear();
      dirty.bld.clear();
    };

    const tick = () => {
      const now = Date.now();
      if (matchState(match, now).phase !== 'running') return;
      const markers = markersRef.current;
      const sideIds = sidesRef.current.map((s) => s.id);
      // Buildings removed elsewhere (a tech, a cancelled site) leave the mirror.
      for (const id of [...bldM.keys()]) if (!markers.some((m) => m.id === id)) bldM.delete(id);
      let sites = sitesOf(markers, bldM);
      const hqs = markers.filter((m) => m.kind === 'hq' && m.owner).map((m) => ({ owner: m.owner!, lat: m.lat, lng: m.lng }));
      const mines = markers.filter((m) => m.kind === 'mine');
      const fighters = fightersRef.current();
      let urgent = false;

      // Income for each whole minute.
      const minute = Math.floor((now - match.start) / 60_000);
      if (minute > paidMinute) {
        const n = Math.min(5, minute - paidMinute);
        paidMinute = minute;
        const inc = minuteIncome(sideIds, mines);
        for (const s of sideIds) {
          bankM.set(s, bankOf(s) + inc[s] * n);
          dirty.bank.add(s);
        }
      }

      // Packs filled at the HQ or a depot.
      const carryNow: Record<string, number> = {};
      for (const f of fighters) carryNow[f.uid] = carryOf(f.uid);
      const bankNow: Record<string, number> = {};
      for (const s of sideIds) bankNow[s] = bankOf(s);
      const got = pickups(fighters, carryNow, bankNow, hqs, sites, since, now);
      for (const [uid, c] of Object.entries(got.carry)) {
        carryM.set(uid, c);
        carryNow[uid] = c;
        dirty.carry.add(uid);
        urgent = true;
      }
      for (const s of sideIds) {
        if (got.bank[s] !== bankNow[s]) {
          bankM.set(s, got.bank[s]);
          dirty.bank.add(s);
        }
      }

      // Building and wrecking.
      const step = buildTick(sites, fighters, carryNow);
      for (const [uid, c] of Object.entries(step.carry)) {
        carryM.set(uid, c);
        dirty.carry.add(uid);
      }
      for (const s of step.changed) {
        const was = bldM.get(s.id) ?? sites.find((x) => x.id === s.id)?.bld;
        bldM.set(s.id, s.bld);
        dirty.bld.add(s.id);
        if (s.bld.built && !was?.built) urgent = true;
      }
      for (const id of step.wrecked) {
        bldM.delete(id);
        dirty.bld.delete(id);
        games.deleteGameMarker(gameId, id).catch(() => {});
      }
      sites = sitesOf(markers, bldM).filter((s) => !step.wrecked.includes(s.id));

      // Enemies who came close find the building.
      for (const d of detections(sites, fighters)) {
        const s = sites.find((x) => x.id === d.id)!;
        const b = { ...(bldM.get(d.id) ?? s.bld) };
        b.seen = [...new Set([...b.seen, d.side])];
        bldM.set(d.id, b);
        dirty.bld.add(d.id);
        urgent = true;
      }
      sites = sitesOf(markers, bldM).filter((s) => !step.wrecked.includes(s.id));

      // Mines change hands like flags (written only on change).
      for (const m of mines) {
        const next = mineStep({ lat: m.lat, lng: m.lng, owner: m.owner ?? null, mcap: m.mcap, block: m.block }, fighters, now);
        if (next.captured) {
          games
            .updateGameMarker(gameId, m.id, { owner: next.owner, mcap: null, log: [...(m.log ?? []), { s: next.owner!, t: now }] })
            .catch(() => {});
        } else if ((next.mcap?.s ?? null) !== (m.mcap?.s ?? null)) {
          games.updateGameMarker(gameId, m.id, { mcap: next.mcap }).catch(() => {});
        }
      }

      // Strikes and scans the command posts ordered.
      for (const h of markers) {
        if ((h.kind !== 'strike' && h.kind !== 'scan') || !h.hit || !h.owner) continue;
        if (h.hit.done || h.hit.void) {
          if (now - h.hit.at > HIT_KEEP_MS) games.deleteGameMarker(gameId, h.id).catch(() => {});
          continue;
        }
        if (h.kind === 'scan') {
          const recon = abilityReady(h.owner, 'b-recon', sites, h.hit.at);
          if (!recon) {
            games.updateGameMarker(gameId, h.id, { hit: { ...h.hit, void: true } }).catch(() => {});
            continue;
          }
          bldM.set(recon.id, { ...recon.bld, ready: now + COOLDOWN_MS });
          dirty.bld.add(recon.id);
          const found = reconScan(h.owner, h, sites, fighters);
          for (const id of found.sites) {
            const s = sites.find((x) => x.id === id)!;
            const b = bldM.get(id) ?? s.bld;
            if (!b.seen.includes(h.owner)) {
              bldM.set(id, { ...b, seen: [...b.seen, h.owner] });
              dirty.bld.add(id);
            }
          }
          games
            .updateGameMarker(gameId, h.id, { hit: { at: h.hit.at, done: true, found: found.fighters.slice(0, 40) } })
            .catch(() => {});
          urgent = true;
          continue;
        }
        // Air strike: an airfield ready at the moment of the order takes it (and starts
        // its cooldown)…
        if (!h.hit.ok && !accepted.has(h.id)) {
          const air = abilityReady(h.owner, 'b-air', sites, h.hit.at - STRIKE_WARN_MS);
          if (!air) {
            games.updateGameMarker(gameId, h.id, { hit: { ...h.hit, void: true } }).catch(() => {});
            continue;
          }
          accepted.add(h.id);
          bldM.set(air.id, { ...air.bld, ready: h.hit.at - STRIKE_WARN_MS + COOLDOWN_MS });
          dirty.bld.add(air.id);
          games.updateGameMarker(gameId, h.id, { hit: { ...h.hit, ok: true } }).catch(() => {});
          urgent = true;
        }
        // …and lands STRIKE_WARN_MS later.
        if (now < h.hit.at) continue;
        const hits = strikeHits(h, sites, mines.map((m) => ({ id: m.id, lat: m.lat, lng: m.lng })));
        for (const id of hits.sites) {
          bldM.delete(id);
          dirty.bld.delete(id);
          games.deleteGameMarker(gameId, id).catch(() => {});
        }
        for (const id of hits.mines) {
          games.updateGameMarker(gameId, id, { owner: null, mcap: null, block: now + MINE_BLOCK_MS }).catch(() => {});
        }
        games.updateGameMarker(gameId, h.id, { hit: { at: h.hit.at, done: true } }).catch(() => {});
        urgent = true;
      }

      flush(urgent);
    };

    const t = setInterval(tick, TICK_MS);
    return () => {
      clearInterval(t);
      flush(true);
    };
  }, [active, gameId, match, hasSquad]);
}
