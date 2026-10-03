import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';

import { firestore } from '../lib/firebase';
import { newId } from '../lib/storage';

export type ChatMessage = {
  /** Client-generated, so a message relayed over several paths is stored once. */
  id: string;
  uid: string;
  callsign: string;
  text: string;
  createdAt: number;
  /** Not yet confirmed by the server (sent offline or still in flight). */
  pending?: boolean;
};

export const MAX_MESSAGE = 500;
const HISTORY = 200;

/**
 * Team chat over Firestore. Firestore queues writes while offline and delivers them
 * when the connection returns; a Bluetooth relay can later feed the same ids in.
 */
export function subscribeMessages(
  teamId: string,
  onMessages: (m: ChatMessage[]) => void,
  onError: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    query(collection(firestore(), 'teams', teamId, 'messages'), orderBy('createdAt', 'desc'), limit(HISTORY)),
    { includeMetadataChanges: true },
    (s) =>
      onMessages(
        s.docs
          .map((d) => {
            const v = d.data({ serverTimestamps: 'estimate' });
            return {
              id: d.id,
              uid: v.uid,
              callsign: v.callsign ?? '???',
              text: v.text ?? '',
              createdAt: v.createdAt instanceof Timestamp ? v.createdAt.toMillis() : Date.now(),
              pending: d.metadata.hasPendingWrites,
            };
          })
          .reverse()
      ),
    onError
  );
}

export async function sendMessage(teamId: string, uid: string, callsign: string, text: string): Promise<void> {
  const id = `${uid.slice(0, 8)}-${newId()}`;
  await setDoc(doc(firestore(), 'teams', teamId, 'messages', id), {
    uid,
    callsign,
    text: text.trim().slice(0, MAX_MESSAGE),
    createdAt: serverTimestamp(),
  });
}
