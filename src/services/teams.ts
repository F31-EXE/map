import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';

import { firestore } from '../lib/firebase';
import { MEMBER_COLORS } from '../lib/markerKinds';
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

function colorFor(uid: string): string {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return MEMBER_COLORS[h % MEMBER_COLORS.length];
}

function millis(v: unknown): number | null {
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === 'number') return v;
  return null;
}

export async function createTeam(uid: string, callsign: string, name: string): Promise<string> {
  const db = firestore();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const codeRef = doc(db, 'teamCodes', code);
    if ((await getDoc(codeRef)).exists()) continue;
    const teamRef = doc(collection(db, 'teams'));
    const batch = writeBatch(db);
    batch.set(teamRef, { name, code, ownerId: uid, createdAt: serverTimestamp() });
    batch.set(codeRef, { teamId: teamRef.id });
    batch.set(doc(teamRef, 'members', uid), {
      callsign,
      color: colorFor(uid),
      joinCode: code,
      joinedAt: serverTimestamp(),
    });
    await batch.commit();
    return teamRef.id;
  }
  throw new Error('Не удалось подобрать свободный код команды, попробуйте ещё раз');
}

export async function joinTeam(uid: string, callsign: string, rawCode: string): Promise<string> {
  const db = firestore();
  const code = normalizeCode(rawCode);
  const snap = await getDoc(doc(db, 'teamCodes', code));
  if (!snap.exists()) throw new Error(`Команда с кодом ${code} не найдена`);
  const teamId = snap.data().teamId as string;
  await setDoc(doc(db, 'teams', teamId, 'members', uid), {
    callsign,
    color: colorFor(uid),
    joinCode: code,
    joinedAt: serverTimestamp(),
  });
  return teamId;
}

export async function leaveTeam(teamId: string, uid: string): Promise<void> {
  await deleteDoc(doc(firestore(), 'teams', teamId, 'members', uid));
}

export async function kickMember(teamId: string, memberId: string): Promise<void> {
  await deleteDoc(doc(firestore(), 'teams', teamId, 'members', memberId));
}

export async function updateCallsign(teamId: string, uid: string, callsign: string): Promise<void> {
  await updateDoc(doc(firestore(), 'teams', teamId, 'members', uid), { callsign });
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
      onTeam(d ? { id: s.id, name: d.name, code: d.code, ownerId: d.ownerId } : null);
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
            color: v.color ?? '#43a047',
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
  m: Omit<TacMarker, 'id' | 'createdAt'>
): Promise<void> {
  await addDoc(collection(firestore(), 'teams', teamId, 'markers'), {
    ...m,
    createdAt: serverTimestamp(),
  });
}

export async function deleteTeamMarker(teamId: string, markerId: string): Promise<void> {
  await deleteDoc(doc(firestore(), 'teams', teamId, 'markers', markerId));
}
