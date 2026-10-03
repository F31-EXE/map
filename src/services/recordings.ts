import {
  arrayUnion,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';

import { firestore } from '../lib/firebase';
import { roleOf, type RoleId } from '../lib/roles';
import type { TrackPoint } from '../lib/tracks';

/*
 * teams/{teamId}                                   + { recordingId }   active recording, if any
 * teams/{teamId}/recordings/{recId}                { name, startedAt, endedAt, startedBy }
 * teams/{teamId}/recordings/{recId}/tracks/{uid}   { callsign, role, points: [{ lat, lng, t }] }
 */

export type Recording = {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
};

export type Track = { uid: string; callsign: string; role: RoleId; points: TrackPoint[] };

const ms = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : null);

export async function startRecording(teamId: string, uid: string, name: string): Promise<void> {
  const db = firestore();
  const ref = doc(collection(db, 'teams', teamId, 'recordings'));
  const batch = writeBatch(db);
  batch.set(ref, { name, startedBy: uid, startedAt: serverTimestamp(), endedAt: null });
  batch.update(doc(db, 'teams', teamId), { recordingId: ref.id });
  await batch.commit();
}

export async function stopRecording(teamId: string, recId: string): Promise<void> {
  const db = firestore();
  const batch = writeBatch(db);
  batch.update(doc(db, 'teams', teamId, 'recordings', recId), { endedAt: serverTimestamp() });
  batch.update(doc(db, 'teams', teamId), { recordingId: null });
  await batch.commit();
}

/** Appends one point to the caller's track (called alongside position publishing). */
export async function appendTrackPoint(
  teamId: string,
  recId: string,
  uid: string,
  who: { callsign: string; role: RoleId },
  p: TrackPoint
): Promise<void> {
  await setDoc(
    doc(firestore(), 'teams', teamId, 'recordings', recId, 'tracks', uid),
    { callsign: who.callsign, role: who.role, points: arrayUnion({ lat: p.lat, lng: p.lng, t: p.t }) },
    { merge: true }
  );
}

export function subscribeRecordings(
  teamId: string,
  onList: (r: Recording[]) => void,
  onError: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    query(collection(firestore(), 'teams', teamId, 'recordings'), orderBy('startedAt', 'desc')),
    (s) =>
      onList(
        s.docs.map((d) => {
          const v = d.data({ serverTimestamps: 'estimate' });
          return { id: d.id, name: v.name ?? 'Игра', startedAt: ms(v.startedAt) ?? Date.now(), endedAt: ms(v.endedAt) };
        })
      ),
    onError
  );
}

export async function loadTracks(teamId: string, recId: string): Promise<Track[]> {
  const s = await getDocs(collection(firestore(), 'teams', teamId, 'recordings', recId, 'tracks'));
  return s.docs.map((d) => {
    const v = d.data();
    return {
      uid: d.id,
      callsign: v.callsign ?? '???',
      role: roleOf(v.role),
      points: Array.isArray(v.points) ? v.points : [],
    };
  });
}
