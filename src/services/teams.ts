import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';

import { firestore } from '../lib/firebase';
import { DEFAULT_TEAM_COLOR, roleOf, type RoleId } from '../lib/roles';
import type { Member, SelfPosition, TacMarker, Team } from '../lib/types';

// No 0/O/1/I/L to keep codes easy to dictate over the radio.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(length = 6): string {
  let s = '';
  for (let i = 0; i < length; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function millis(v: unknown): number | null {
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === 'number') return v;
  return null;
}

export async function createTeam(uid: string, callsign: string, role: RoleId, name: string): Promise<string> {
  const db = firestore();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const codeRef = doc(db, 'teamCodes', code);
    if ((await getDoc(codeRef)).exists()) continue;
    const teamRef = doc(collection(db, 'teams'));
    const batch = writeBatch(db);
    batch.set(teamRef, { name, code, ownerId: uid, color: DEFAULT_TEAM_COLOR, createdAt: serverTimestamp() });
    batch.set(codeRef, { teamId: teamRef.id });
    batch.set(doc(teamRef, 'members', uid), {
      callsign,
      role,
      joinCode: code,
      joinedAt: serverTimestamp(),
    });
    await batch.commit();
    return teamRef.id;
  }
  throw new Error('Не удалось подобрать свободный код команды, попробуйте ещё раз');
}

export async function joinTeam(uid: string, callsign: string, role: RoleId, rawCode: string): Promise<string> {
  const db = firestore();
  const code = normalizeCode(rawCode);
  const snap = await getDoc(doc(db, 'teamCodes', code));
  if (!snap.exists()) throw new Error(`Команда с кодом ${code} не найдена`);
  const teamId = snap.data().teamId as string;
  await setDoc(doc(db, 'teams', teamId, 'members', uid), {
    callsign,
    role,
    joinCode: code,
    joinedAt: serverTimestamp(),
  });
  return teamId;
}

/**
 * Server-side membership check. Query snapshots alone can't answer this: while our own
 * position update is in flight, Firestore may briefly leave our doc out of the results.
 */
export async function isMember(teamId: string, uid: string): Promise<boolean> {
  try {
    return (await getDocFromServer(doc(firestore(), 'teams', teamId, 'members', uid))).exists();
  } catch (e) {
    // Removed members lose read access to the team.
    if (isPermissionDenied(e)) return false;
    throw e;
  }
}

export function isPermissionDenied(e: unknown): boolean {
  return (e as { code?: string })?.code === 'permission-denied';
}

export async function leaveTeam(teamId: string, uid: string): Promise<void> {
  await deleteDoc(doc(firestore(), 'teams', teamId, 'members', uid));
}

export async function kickMember(teamId: string, memberId: string): Promise<void> {
  await deleteDoc(doc(firestore(), 'teams', teamId, 'members', memberId));
}

export async function updateProfile(
  teamId: string,
  uid: string,
  profile: { callsign?: string; role?: RoleId }
): Promise<void> {
  await updateDoc(doc(firestore(), 'teams', teamId, 'members', uid), profile);
}

/** Team creator only (enforced by rules). */
export async function setCanCommand(teamId: string, memberId: string, canCommand: boolean): Promise<void> {
  await updateDoc(doc(firestore(), 'teams', teamId, 'members', memberId), { canCommand });
}

/** Team creator only (enforced by rules). */
export async function setTeamColor(teamId: string, color: string): Promise<void> {
  await updateDoc(doc(firestore(), 'teams', teamId), { color });
}

/**
 * Avatars live in their own collection: they change rarely, so keeping them out of
 * member docs avoids resending a few KB to everyone on every position update.
 */
export async function setAvatar(teamId: string, uid: string, data: string | null): Promise<void> {
  const ref = doc(firestore(), 'teams', teamId, 'avatars', uid);
  if (data) await setDoc(ref, { data, updatedAt: serverTimestamp() });
  else await deleteDoc(ref);
}

export function subscribeAvatars(
  teamId: string,
  onAvatars: (a: Record<string, string>) => void,
  onError: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    collection(firestore(), 'teams', teamId, 'avatars'),
    (s) => {
      const out: Record<string, string> = {};
      s.docs.forEach((d) => {
        const v = d.data().data;
        if (typeof v === 'string') out[d.id] = v;
      });
      onAvatars(out);
    },
    onError
  );
}

export async function publishPosition(teamId: string, uid: string, p: SelfPosition): Promise<void> {
  await updateDoc(doc(firestore(), 'teams', teamId, 'members', uid), {
    lat: p.lat,
    lng: p.lng,
    accuracy: p.accuracy,
    heading: p.heading,
    updatedAt: serverTimestamp(),
  });
}

export async function clearPosition(teamId: string, uid: string): Promise<void> {
  await updateDoc(doc(firestore(), 'teams', teamId, 'members', uid), {
    lat: null,
    lng: null,
    heading: null,
    updatedAt: serverTimestamp(),
  });
}

export function subscribeTeam(
  teamId: string,
  onTeam: (t: Team | null) => void,
  onError: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    doc(firestore(), 'teams', teamId),
    (s) => {
      const d = s.data();
      onTeam(
        d
          ? { id: s.id, name: d.name, code: d.code, ownerId: d.ownerId, color: d.color ?? DEFAULT_TEAM_COLOR }
          : null
      );
    },
    onError
  );
}

export function subscribeMembers(
  teamId: string,
  onMembers: (m: Member[]) => void,
  onError: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    collection(firestore(), 'teams', teamId, 'members'),
    (s) => {
      onMembers(
        s.docs.map((d) => {
          const v = d.data({ serverTimestamps: 'estimate' });
          return {
            id: d.id,
            callsign: v.callsign ?? '???',
            role: roleOf(v.role),
            canCommand: v.canCommand === true,
            lat: typeof v.lat === 'number' ? v.lat : null,
            lng: typeof v.lng === 'number' ? v.lng : null,
            heading: typeof v.heading === 'number' ? v.heading : null,
            updatedAt: millis(v.updatedAt),
          };
        })
      );
    },
    onError
  );
}

export function subscribeTeamMarkers(
  teamId: string,
  onMarkers: (m: TacMarker[]) => void,
  onError: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    collection(firestore(), 'teams', teamId, 'markers'),
    (s) => {
      onMarkers(
        s.docs.map((d) => {
          const v = d.data({ serverTimestamps: 'estimate' });
          return {
            id: d.id,
            kind: v.kind,
            label: v.label ?? '',
            lat: v.lat,
            lng: v.lng,
            createdBy: v.createdBy,
            createdByName: v.createdByName ?? '',
            createdAt: millis(v.createdAt) ?? Date.now(),
          };
        })
      );
    },
    onError
  );
}

export async function addTeamMarker(
  teamId: string,
  m: Omit<TacMarker, 'id' | 'createdAt' | 'personal'>
): Promise<void> {
  await addDoc(collection(firestore(), 'teams', teamId, 'markers'), {
    ...m,
    createdAt: serverTimestamp(),
  });
}

export async function deleteTeamMarker(teamId: string, markerId: string): Promise<void> {
  await deleteDoc(doc(firestore(), 'teams', teamId, 'markers', markerId));
}
