/**
 * Big games (see firestore.rules for the model): game techs run them, sides join with
 * the game's side code, every fighter registers under the game for its modes.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';

import { firestore } from '../lib/firebase';
import { SIDE_COLORS } from '../lib/gameModes';
import { normalizeCode } from '../lib/invite';
import { newId } from '../lib/storage';
import type { Game, GamePlayer, GameSide, GameTech, Side, TacMarker } from '../lib/types';
import { randomCode } from './teams';

const millis = (v: { toMillis?: () => number } | undefined | null) => (v?.toMillis ? v.toMillis() : null);

async function freeCode(collectionName: string): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const code = randomCode();
    if (!(await getDoc(doc(firestore(), collectionName, code))).exists()) return code;
  }
  throw new Error('Не удалось подобрать свободный код, попробуйте ещё раз');
}

export async function createGame(uid: string, callsign: string, name: string): Promise<string> {
  const db = firestore();
  const techCode = await freeCode('gameCodes');
  let sideCode = await freeCode('gameCodes');
  if (sideCode === techCode) sideCode = await freeCode('gameCodes');
  const ref = doc(collection(db, 'games'));
  const b = writeBatch(db);
  b.set(ref, { name: name.slice(0, 60), ownerId: uid, techCode, sideCode, tickets: null, match: null, createdAt: serverTimestamp() });
  b.set(doc(db, 'gameCodes', techCode), { gameId: ref.id, kind: 'tech' });
  b.set(doc(db, 'gameCodes', sideCode), { gameId: ref.id, kind: 'side' });
  b.set(doc(db, 'games', ref.id, 'techs', uid), { callsign: callsign.slice(0, 24), updatedAt: serverTimestamp() });
  await b.commit();
  return ref.id;
}

async function lookup(rawCode: string): Promise<{ gameId: string; kind: 'tech' | 'side'; code: string }> {
  const code = normalizeCode(rawCode);
  const s = await getDoc(doc(firestore(), 'gameCodes', code));
  if (!s.exists()) throw new Error(`Игра с кодом ${code} не найдена`);
  return { gameId: s.data().gameId, kind: s.data().kind, code };
}

/** Joins as a game tech with the tech code; returns the game id. */
export async function joinAsTech(uid: string, callsign: string, rawCode: string): Promise<string> {
  const { gameId, kind, code } = await lookup(rawCode);
  if (kind !== 'tech') throw new Error('Это код для командиров сторон, а не для игротехов');
  await setDoc(doc(firestore(), 'games', gameId, 'techs', uid), {
    callsign: callsign.slice(0, 24),
    code,
    updatedAt: serverTimestamp(),
  });
  return gameId;
}

export async function leaveTech(gameId: string, uid: string): Promise<void> {
  await deleteDoc(doc(firestore(), 'games', gameId, 'techs', uid));
}

/** A side commander brings their side into a game with its side code. */
export async function attachSide(side: Side, rawCode: string, callsign: string): Promise<string> {
  const { gameId, kind, code } = await lookup(rawCode);
  if (kind !== 'side') throw new Error('Это код игротеха. Командиру стороны нужен код «для сторон»');
  const db = firestore();
  await updateDoc(doc(db, 'sides', side.id), { gameId, gameCode: code });
  const scoreRef = doc(db, 'games', gameId, 'sides', side.id);
  // The commander registers right away: that lets them read the game's sides.
  await registerPlayer(gameId, side.ownerId, { sideId: side.id, teamId: null, callsign: callsign || 'Командир' });
  if (!(await getDoc(scoreRef)).exists()) {
    // A color no other side of the game has yet.
    const taken = new Set((await getDocs(collection(db, 'games', gameId, 'sides'))).docs.map((d) => d.data().color));
    const color = SIDE_COLORS.find((c) => !taken.has(c)) ?? SIDE_COLORS[taken.size % SIDE_COLORS.length];
    await setDoc(scoreRef, { name: side.name.slice(0, 40), color });
  }
  return gameId;
}

export async function detachSide(sideId: string): Promise<void> {
  await updateDoc(doc(firestore(), 'sides', sideId), { gameId: null, gameCode: null });
}

/**
 * A tech makes a side inside the game; its commander takes it over later with the
 * claim code (invite link), and then runs it like any other side.
 */
export async function createSideInGame(game: Game, uid: string, name: string, color: string): Promise<Side> {
  const db = firestore();
  const code = await freeCode('sideCodes');
  const claim = randomCode() + randomCode();
  const ref = doc(collection(db, 'sides'));
  const b = writeBatch(db);
  b.set(ref, { name: name.slice(0, 40), code, ownerId: uid, gameId: game.id, gameCode: game.sideCode, claim, createdAt: serverTimestamp() });
  b.set(doc(db, 'sideCodes', code), { sideId: ref.id });
  b.set(doc(db, 'games', game.id, 'sides', ref.id), { name: name.slice(0, 40), color });
  await b.commit();
  return { id: ref.id, name, code, ownerId: uid, gameId: game.id, claim };
}

export async function claimSide(sideId: string, uid: string, claim: string): Promise<void> {
  await updateDoc(doc(firestore(), 'sides', sideId), { ownerId: uid, claim: null, claimedWith: claim }).catch(() => {
    throw new Error('Сторону уже принял другой командир или ссылка неверна');
  });
}

export function subscribeGame(gameId: string, onGame: (g: Game | null) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    doc(firestore(), 'games', gameId),
    (s) => {
      const d = s.data();
      onGame(
        d
          ? {
              id: s.id,
              name: d.name,
              ownerId: d.ownerId,
              techCode: d.techCode,
              sideCode: d.sideCode,
              tickets: typeof d.tickets === 'number' ? d.tickets : null,
              tiebreak: d.tiebreak === 'time' ? 'time' : 'draw',
              match:
                d.match && typeof d.match.start === 'number'
                  ? { start: d.match.start, minutes: d.match.minutes, stoppedAt: d.match.stoppedAt ?? null, pausedAt: d.match.pausedAt ?? null }
                  : null,
            }
          : null
      );
    },
    onError
  );
}

export async function getGame(gameId: string): Promise<{ id: string; name: string } | null> {
  const s = await getDoc(doc(firestore(), 'games', gameId));
  const d = s.data();
  return d ? { id: s.id, name: d.name } : null;
}

export function subscribeTechs(gameId: string, on: (t: GameTech[]) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    collection(firestore(), 'games', gameId, 'techs'),
    (s) =>
      on(
        s.docs.map((d) => {
          const v = d.data({ serverTimestamps: 'estimate' });
          return {
            uid: d.id,
            callsign: v.callsign ?? 'Игротех',
            lat: typeof v.lat === 'number' ? v.lat : null,
            lng: typeof v.lng === 'number' ? v.lng : null,
            heading: typeof v.heading === 'number' ? v.heading : null,
            updatedAt: millis(v.updatedAt),
          };
        })
      ),
    onError
  );
}

export async function reportTech(gameId: string, uid: string, p: { lat: number; lng: number; heading: number | null }) {
  await updateDoc(doc(firestore(), 'games', gameId, 'techs', uid), {
    lat: p.lat,
    lng: p.lng,
    heading: p.heading,
    updatedAt: serverTimestamp(),
  });
}

export function subscribeGameSides(gameId: string, on: (s: GameSide[]) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    collection(firestore(), 'games', gameId, 'sides'),
    (s) =>
      on(
        s.docs.map((d) => ({
          id: d.id,
          name: d.data().name ?? 'Сторона',
          color: d.data().color ?? SIDE_COLORS[0],
          tickets: typeof d.data().tickets === 'number' ? d.data().tickets : 0,
        }))
      ),
    onError
  );
}

export async function setGameSide(gameId: string, s: GameSide): Promise<void> {
  await setDoc(doc(firestore(), 'games', gameId, 'sides', s.id), {
    name: s.name.slice(0, 40),
    color: s.color,
    tickets: s.tickets ?? 0,
  });
}

/** Techs: the sides (with commanders and claim codes) playing in the game. */
export function subscribeSidesOfGame(gameId: string, on: (s: Side[]) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    query(collection(firestore(), 'sides'), where('gameId', '==', gameId)),
    (s) =>
      on(
        s.docs.map((d) => {
          const v = d.data();
          return { id: d.id, name: v.name, code: v.code, ownerId: v.ownerId, gameId, claim: v.claim ?? null };
        })
      ),
    onError
  );
}

export function subscribePlayers(gameId: string, on: (p: GamePlayer[]) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    collection(firestore(), 'games', gameId, 'players'),
    (s) =>
      on(
        s.docs.map((d) => {
          const v = d.data();
          return {
            uid: d.id,
            sideId: v.sideId,
            teamId: v.teamId ?? null,
            callsign: v.callsign ?? '',
            pts: v.pts && typeof v.pts === 'object' ? v.pts : {},
            deaths: typeof v.deaths === 'number' ? v.deaths : 0,
            cell: typeof v.cell === 'string' ? v.cell : null,
            cellAt: typeof v.cellAt === 'number' ? v.cellAt : null,
          };
        })
      ),
    onError
  );
}

/** A fighter (or side commander) enters the game's register. */
export async function registerPlayer(
  gameId: string,
  uid: string,
  p: { sideId: string; teamId: string | null; callsign: string }
): Promise<void> {
  const ref = doc(firestore(), 'games', gameId, 'players', uid);
  const cur = await getDoc(ref);
  if (cur.exists() && cur.data().sideId === p.sideId && (cur.data().teamId ?? null) === p.teamId) return;
  if (cur.exists()) await deleteDoc(ref);
  await setDoc(ref, { ...p, callsign: p.callsign.slice(0, 24), pts: {}, deaths: 0 });
}

export async function addDeath(gameId: string, uid: string): Promise<void> {
  await updateDoc(doc(firestore(), 'games', gameId, 'players', uid), { deaths: increment(1) });
}

export async function addZonePoints(gameId: string, uid: string, zoneId: string, n: number): Promise<void> {
  await updateDoc(doc(firestore(), 'games', gameId, 'players', uid), { [`pts.${zoneId}`]: increment(n) });
}

export async function reportCell(gameId: string, uid: string, cell: string | null, minute: number): Promise<void> {
  await updateDoc(doc(firestore(), 'games', gameId, 'players', uid), { cell, cellAt: minute });
}

export async function setMatch(gameId: string, match: Game['match']): Promise<void> {
  await updateDoc(doc(firestore(), 'games', gameId), { match });
}

export async function setTiebreak(gameId: string, tiebreak: 'draw' | 'time'): Promise<void> {
  await updateDoc(doc(firestore(), 'games', gameId), { tiebreak });
}

export async function setTickets(gameId: string, tickets: number | null): Promise<void> {
  await updateDoc(doc(firestore(), 'games', gameId), { tickets });
}

export function subscribeGameMarkers(
  gameId: string,
  on: (m: TacMarker[]) => void,
  onError: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    collection(firestore(), 'games', gameId, 'markers'),
    (s) =>
      on(
        s.docs.map((d) => {
          const v = d.data({ serverTimestamps: 'estimate' });
          return {
            ...(v as Omit<TacMarker, 'id'>),
            id: d.id,
            label: v.label ?? '',
            createdAt: millis(v.createdAt) ?? Date.now(),
            owner: typeof v.owner === 'string' ? v.owner : null,
            log: Array.isArray(v.log) ? v.log : [],
            gameId,
          } as TacMarker;
        })
      ),
    onError
  );
}

export async function addGameMarker(gameId: string, m: Omit<TacMarker, 'id' | 'createdAt'>): Promise<string> {
  const id = newId();
  const clean = Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined));
  await setDoc(doc(firestore(), 'games', gameId, 'markers', id), { ...clean, createdAt: serverTimestamp() });
  return id;
}

/** Several markers at once (the nine territory sectors). */
export async function addGameMarkers(gameId: string, list: Omit<TacMarker, 'id' | 'createdAt'>[]): Promise<void> {
  const db = firestore();
  const b = writeBatch(db);
  for (const m of list) {
    const clean = Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined));
    b.set(doc(db, 'games', gameId, 'markers', newId()), { ...clean, createdAt: serverTimestamp() });
  }
  await b.commit();
}

export async function deleteGameMarker(gameId: string, id: string): Promise<void> {
  await deleteDoc(doc(firestore(), 'games', gameId, 'markers', id));
}

export async function updateGameMarker(gameId: string, id: string, patch: Partial<TacMarker>): Promise<void> {
  await updateDoc(doc(firestore(), 'games', gameId, 'markers', id), patch as Record<string, unknown>);
}

/** A flag or sector changes hands: new owner and one more entry in its log. */
export async function setHolder(gameId: string, m: TacMarker, owner: string, at: number): Promise<void> {
  await updateDoc(doc(firestore(), 'games', gameId, 'markers', m.id), {
    owner,
    log: [...(m.log ?? []), { s: owner, t: at }],
  });
}
