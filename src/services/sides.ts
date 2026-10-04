import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
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

export function subscribeSide(
  sideId: string,
  onSide: (s: Side | null) => void,
  onError: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    doc(firestore(), 'sides', sideId),
    (s) => {
      const d = s.data();
      onSide(d ? { id: s.id, name: d.name, code: d.code, ownerId: d.ownerId } : null);
    },
    onError
  );
}

export async function getSide(sideId: string): Promise<Side | null> {
  const s = await getDoc(doc(firestore(), 'sides', sideId));
  const d = s.data();
  return d ? { id: s.id, name: d.name, code: d.code, ownerId: d.ownerId } : null;
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
