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
import type { OrderKind, Side, Team } from '../lib/types';
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
  await updateDoc(doc(firestore(), 'teams', teamId), { sideId: null, sideCode: null });
}

function toSide(id: string, d: Record<string, any>): Side {
  return {
    id,
    name: d.name,
    code: d.code,
    ownerId: d.ownerId,
    gameId: typeof d.gameId === 'string' ? d.gameId : null,
    claim: typeof d.claim === 'string' ? d.claim : null,
    deputies:
      d.deputies && typeof d.deputies === 'object'
        ? Object.fromEntries(Object.entries(d.deputies).filter(([, v]) => typeof v === 'string')) as Record<string, string>
        : {},
  };
}

/** Names (or removes, `callsign` null) an HQ signaller with the commander's rights. */
export async function setDeputy(sideId: string, uid: string, callsign: string | null): Promise<void> {
  await updateDoc(doc(firestore(), 'sides', sideId), {
    [`deputies.${uid}`]: callsign == null ? deleteField() : callsign.slice(0, 24),
  });
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
