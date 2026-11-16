import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';

import { firestore } from '../lib/firebase';
import { normalizeCode } from '../lib/invite';
import { DEFAULT_TEAM_COLOR } from '../lib/roles';
import { newId } from '../lib/storage';
import type { Deputy, DeputyPerm, Direction, HqPerson, OrderKind, Side, Team } from '../lib/types';
import { randomCode } from './teams';

/*
 * Data model:
 *   sides/{sideId}        { name, code, ownerId, createdAt }
 *   sideCodes/{code}      { sideId }
 *   teams/{teamId}        + { sideId, sideCode }   set by the squad leader to attach
 *
 * The side commander reads attached squads (members and markers) and places orders
 * straight into each squad's markers with audience "commanders".
 */

export async function createSide(uid: string, name: string): Promise<string> {
  const db = firestore();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const codeRef = doc(db, 'sideCodes', code);
    if ((await getDoc(codeRef)).exists()) continue;
    const sideRef = doc(collection(db, 'sides'));
    const batch = writeBatch(db);
    batch.set(sideRef, { name, code, ownerId: uid, createdAt: serverTimestamp() });
    batch.set(codeRef, { sideId: sideRef.id });
    await batch.commit();
    return sideRef.id;
  }
  throw new Error('Не удалось подобрать свободный код стороны, попробуйте ещё раз');
}

/** Squad leader attaches their squad to a side by its code. */
export async function attachTeam(teamId: string, rawCode: string): Promise<void> {
  const db = firestore();
  const code = normalizeCode(rawCode);
  const snap = await getDoc(doc(db, 'sideCodes', code));
  if (!snap.exists()) throw new Error(`Сторона с кодом ${code} не найдена`);
  await updateDoc(doc(db, 'teams', teamId), { sideId: snap.data().sideId, sideCode: code });
}

/** Squad leader leaves the side, or the side commander drops a squad. */
export async function detachTeam(teamId: string): Promise<void> {
  await updateDoc(doc(firestore(), 'teams', teamId), { sideId: null, sideCode: null, dirId: null, dirCode: null });
}

function toSide(id: string, d: Record<string, any>): Side {
  return {
    id,
    name: d.name,
    code: d.code,
    ownerId: d.ownerId,
    gameId: typeof d.gameId === 'string' ? d.gameId : null,
    claim: typeof d.claim === 'string' ? d.claim : null,
    deputies: parseDeputies(d.deputies),
    directions: parseDirections(d.directions),
    hqCode: typeof d.hqCode === 'string' ? d.hqCode : null,
  };
}

const ALL_PERMS: DeputyPerm[] = ['orders', 'game', 'squads', 'directions'];

/** Deputies: { uid: { name, perms } }; older entries were just a callsign (every right). */
function parseDeputies(v: unknown): Record<string, Deputy> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, Deputy> = {};
  for (const [uid, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x === 'string') out[uid] = { name: x, perms: ALL_PERMS };
    else if (x && typeof x === 'object') {
      const o = x as { name?: unknown; perms?: unknown };
      out[uid] = {
        name: typeof o.name === 'string' ? o.name : 'Заместитель',
        perms: Array.isArray(o.perms) ? (o.perms.filter((p) => ALL_PERMS.includes(p)) as DeputyPerm[]) : [],
      };
    }
  }
  return out;
}

function parseDirections(v: unknown): Record<string, Direction> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, Direction> = {};
  for (const [id, x] of Object.entries(v as Record<string, any>)) {
    if (!x || typeof x !== 'object' || typeof x.code !== 'string') continue;
    out[id] = {
      name: typeof x.name === 'string' ? x.name : 'Направление',
      cmd: typeof x.cmd === 'string' ? x.cmd : null,
      cmdName: typeof x.cmdName === 'string' ? x.cmdName : null,
      code: x.code,
    };
  }
  return out;
}

/** Names (or removes, `d` null) a deputy with the given rights (the commander only). */
export async function setDeputy(sideId: string, uid: string, d: Deputy | null): Promise<void> {
  await updateDoc(doc(firestore(), 'sides', sideId), {
    [`deputies.${uid}`]: d == null ? deleteField() : { name: d.name.slice(0, 24), perms: d.perms },
  });
}

/** The directions as a whole (with the list of their commanders the rules read). */
export async function saveDirections(sideId: string, directions: Record<string, Direction>): Promise<void> {
  const dirCmds = [...new Set(Object.values(directions).map((x) => x.cmd).filter((x): x is string => Boolean(x)))];
  await updateDoc(doc(firestore(), 'sides', sideId), { directions, dirCmds });
}

/** The side's HQ code (made once by the commander). */
export async function ensureHqCode(side: Side): Promise<string> {
  if (side.hqCode) return side.hqCode;
  const code = randomCode();
  await updateDoc(doc(firestore(), 'sides', side.id), { hqCode: code });
  return code;
}

/** Joins a side's HQ with its code (the commander gives a role after). */
export async function joinHq(sideId: string, uid: string, callsign: string, rawCode: string): Promise<void> {
  await setDoc(doc(firestore(), 'sides', sideId, 'hq', uid), {
    callsign: (callsign || 'Штаб').slice(0, 24),
    code: normalizeCode(rawCode),
    at: Date.now(),
  });
}

export async function leaveHq(sideId: string, uid: string): Promise<void> {
  await deleteDoc(doc(firestore(), 'sides', sideId, 'hq', uid));
}

/** HQ people publish where they are, so the side sees its command on the map. */
export async function reportHq(sideId: string, uid: string, p: { lat: number; lng: number; heading: number | null }) {
  await updateDoc(doc(firestore(), 'sides', sideId, 'hq', uid), {
    lat: p.lat,
    lng: p.lng,
    heading: p.heading ?? null,
    updatedAt: Date.now(),
  });
}

export function subscribeHq(sideId: string, on: (list: HqPerson[]) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    collection(firestore(), 'sides', sideId, 'hq'),
    (snap) =>
      on(
        snap.docs.map((d) => {
          const x = d.data();
          return {
            uid: d.id,
            callsign: String(x.callsign ?? ''),
            lat: typeof x.lat === 'number' ? x.lat : null,
            lng: typeof x.lng === 'number' ? x.lng : null,
            heading: typeof x.heading === 'number' ? x.heading : null,
            updatedAt: typeof x.updatedAt === 'number' ? x.updatedAt : null,
          };
        })
      ),
    onError
  );
}

/** A squad leader joins the side and one of its directions with the direction's code. */
export async function joinDirection(teamId: string, sideId: string, dirId: string, rawCode: string): Promise<void> {
  const side = await getSide(sideId);
  if (!side) throw new Error('Сторона не найдена');
  const dir = side.directions?.[dirId];
  if (!dir) throw new Error('Такого направления больше нет');
  await updateDoc(doc(firestore(), 'teams', teamId), {
    sideId,
    sideCode: side.code,
    dirId,
    dirCode: normalizeCode(rawCode),
  });
}

/** The direction commander lets a squad go (it stays on the side). */
export async function leaveDirection(teamId: string): Promise<void> {
  await updateDoc(doc(firestore(), 'teams', teamId), { dirId: null, dirCode: null });
}

/** A direction commander's squads. */
export function subscribeDirectionTeams(
  sideId: string,
  dirId: string,
  onTeams: (teams: Team[]) => void,
  onError: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    query(collection(firestore(), 'teams'), where('sideId', '==', sideId), where('dirId', '==', dirId)),
    (snap) =>
      onTeams(
        snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            name: x.name,
            code: x.code,
            ownerId: x.ownerId,
            color: x.color ?? DEFAULT_TEAM_COLOR,
            sideId: x.sideId ?? null,
            dirId: x.dirId ?? null,
          } as Team;
        })
      ),
    onError
  );
}

/*
 * Side chat: sides/{sideId}/messages/{id} { uid, callsign, text, createdAt, teamId?, teamName?, relayedFrom? }.
 * The command post, squad commanders and signallers talk here; signallers carry messages
 * between it and their squad chat.
 */
export type SideMessage = {
  id: string;
  uid: string;
  callsign: string;
  text: string;
  createdAt: number;
  teamId: string | null;
  teamName: string | null;
  relayedFrom: string | null;
};

export function subscribeSideChat(
  sideId: string,
  onList: (list: SideMessage[]) => void,
  onError: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    query(collection(firestore(), 'sides', sideId, 'messages'), orderBy('createdAt', 'desc'), limit(150)),
    (snap) =>
      onList(
        snap.docs
          .map((d) => {
            const x = d.data();
            return {
              id: d.id,
              uid: String(x.uid ?? ''),
              callsign: String(x.callsign ?? ''),
              text: String(x.text ?? ''),
              createdAt: typeof x.createdAt === 'number' ? x.createdAt : (x.createdAt?.toMillis?.() ?? Date.now()),
              teamId: typeof x.teamId === 'string' ? x.teamId : null,
              teamName: typeof x.teamName === 'string' ? x.teamName : null,
              relayedFrom: typeof x.relayedFrom === 'string' ? x.relayedFrom : null,
            };
          })
          .reverse()
      ),
    onError
  );
}

export async function sendSideMessage(
  sideId: string,
  m: { uid: string; callsign: string; text: string; teamId: string | null; teamName: string | null; relayedFrom?: string | null }
): Promise<void> {
  const data: Record<string, unknown> = {
    uid: m.uid,
    callsign: m.callsign.slice(0, 40),
    text: m.text.trim().slice(0, 1000),
    createdAt: Date.now(),
  };
  if (m.teamId) data.teamId = m.teamId;
  if (m.teamName) data.teamName = m.teamName.slice(0, 40);
  if (m.relayedFrom) data.relayedFrom = m.relayedFrom.slice(0, 40);
  await setDoc(doc(collection(firestore(), 'sides', sideId, 'messages')), data);
}

export function subscribeSide(
  sideId: string,
  onSide: (s: Side | null) => void,
  onError: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    doc(firestore(), 'sides', sideId),
    (s) => {
      const d = s.data();
      onSide(d ? toSide(s.id, d) : null);
    },
    onError
  );
}

export async function getSide(sideId: string): Promise<Side | null> {
  const s = await getDoc(doc(firestore(), 'sides', sideId));
  const d = s.data();
  return d ? toSide(s.id, d) : null;
}

export function subscribeSideTeams(
  sideId: string,
  onTeams: (teams: Team[]) => void,
  onError: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    query(collection(firestore(), 'teams'), where('sideId', '==', sideId)),
    (s) =>
      onTeams(
        s.docs.map((d) => {
          const v = d.data();
          return {
            id: d.id,
            name: v.name,
            code: v.code,
            ownerId: v.ownerId,
            color: v.color ?? DEFAULT_TEAM_COLOR,
            sideId,
          };
        })
      ),
    onError
  );
}

/** One order, copied into every targeted squad; the copies share a groupId. */
export async function placeSideOrder(
  teamIds: string[],
  order: { kind: OrderKind; label: string; lat: number; lng: number; createdBy: string; createdByName: string }
): Promise<void> {
  const db = firestore();
  const batch = writeBatch(db);
  const groupId = newId();
  for (const teamId of teamIds) {
    batch.set(doc(collection(db, 'teams', teamId, 'markers')), {
      ...order,
      audience: 'commanders',
      groupId,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

/**
 * Deletes every copy of a side order. One by one rather than in a batch: each delete
 * runs the rules' rank lookups, and a batch over several squads exceeds Firestore's
 * limit on document reads per request. A squad that has since left the side just
 * keeps its copy; the call fails only if nothing could be deleted.
 */
export async function deleteSideOrder(copies: { teamId: string; id: string }[]): Promise<void> {
  const db = firestore();
  const results = await Promise.allSettled(copies.map((c) => deleteDoc(doc(db, 'teams', c.teamId, 'markers', c.id))));
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed.length && failed.length === results.length) throw failed[0].reason;
}
