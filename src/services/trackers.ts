import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, updateDoc, type Unsubscribe } from 'firebase/firestore';

import { firestore } from '../lib/firebase';
import { roleOf } from '../lib/roles';
import { trackerId, type Tracker, type TrackerVis } from '../lib/trackers';

const col = (teamId: string) => collection(firestore(), 'teams', teamId, 'trackers');

export function subscribeTrackers(teamId: string, onList: (t: Tracker[]) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    col(teamId),
    (s) =>
      onList(
        s.docs.map((d) => {
          const v = d.data();
          const vis: TrackerVis = v.vis === 'commanders' || v.vis === 'chosen' ? v.vis : 'all';
          return {
            num: typeof v.num === 'number' ? v.num : parseInt(d.id, 16) >>> 0,
            name: typeof v.name === 'string' ? v.name : d.id,
            short: typeof v.short === 'string' ? v.short : '',
            role: roleOf(v.role),
            color: typeof v.color === 'string' ? v.color : '#FFC83D',
            vis,
            viewers: Array.isArray(v.viewers) ? v.viewers.filter((x: unknown) => typeof x === 'string') : [],
            addedBy: typeof v.addedBy === 'string' ? v.addedBy : '',
            lat: typeof v.lat === 'number' ? v.lat : null,
            lng: typeof v.lng === 'number' ? v.lng : null,
            at: typeof v.at === 'number' ? v.at : null,
            heardBy: typeof v.heardBy === 'string' ? v.heardBy : null,
          };
        })
      ),
    onError
  );
}

export type TrackerMeta = Pick<Tracker, 'num' | 'name' | 'short' | 'role' | 'color' | 'vis' | 'viewers'>;

/** Adds or edits a tracker (commanders). Keeps a known position. */
export async function saveTracker(teamId: string, uid: string, t: TrackerMeta, isNew: boolean): Promise<void> {
  const ref = doc(col(teamId), trackerId(t.num));
  const meta = { num: t.num, name: t.name, short: t.short, role: t.role, color: t.color, vis: t.vis, viewers: t.viewers };
  if (isNew) await setDoc(ref, { ...meta, addedBy: uid, lat: null, lng: null, at: null, heardBy: null, updatedAt: serverTimestamp() });
  else await updateDoc(ref, meta);
}

export async function removeTracker(teamId: string, num: number): Promise<void> {
  await deleteDoc(doc(col(teamId), trackerId(num)));
}

/** A squad phone heard the tracker: its position for everyone (any member, only newer). */
export async function relayTracker(teamId: string, uid: string, num: number, fix: { lat: number; lng: number; at: number }): Promise<void> {
  await updateDoc(doc(col(teamId), trackerId(num)), {
    lat: fix.lat,
    lng: fix.lng,
    at: fix.at,
    heardBy: uid,
    updatedAt: serverTimestamp(),
  });
}
