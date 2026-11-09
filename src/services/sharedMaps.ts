/**
 * Polygon maps (KMZ/KML/GPX/GeoJSON) shared with the squad: a Firestore doc per map in
 * teams/{teamId}/maps, the file itself as base64 in numbered parts (a doc holds at most
 * 1 MB). Parts are written first, so a map shows up only once it's whole.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';

import { fromBase64, toBase64 } from '../lib/base64';
import { firestore } from '../lib/firebase';
import { newId } from '../lib/storage';
import type { OverlayFormat } from '../lib/types';

/** Characters of base64 per part (rules: under 800 000). */
const PART_CHARS = 700_000;
/** Biggest file that can be shared (≈ 9 parts). */
export const MAX_SHARE_BYTES = 4.5 * 1024 * 1024;

export type SharedMap = {
  id: string;
  name: string;
  format: OverlayFormat;
  size: number;
  parts: number;
  createdBy: string;
  createdByName: string;
  createdAt: number;
};

const FORMATS: OverlayFormat[] = ['kmz', 'kml', 'gpx', 'geojson'];

export async function shareMap(
  teamId: string,
  by: { uid: string; callsign: string },
  m: { name: string; format: OverlayFormat },
  bytes: Uint8Array
): Promise<string> {
  if (bytes.length > MAX_SHARE_BYTES) {
    throw new Error(`Файл ${(bytes.length / 1024 / 1024).toFixed(1)} МБ — отряду можно отправить до 4,5 МБ`);
  }
  const id = newId();
  const text = toBase64(bytes);
  const parts = Math.max(1, Math.ceil(text.length / PART_CHARS));
  for (let i = 0; i < parts; i++) {
    await setDoc(doc(firestore(), 'teams', teamId, 'maps', id, 'parts', String(i).padStart(2, '0')), {
      i,
      data: text.slice(i * PART_CHARS, (i + 1) * PART_CHARS),
      createdBy: by.uid,
    });
  }
  await setDoc(doc(firestore(), 'teams', teamId, 'maps', id), {
    name: m.name.slice(0, 80),
    format: m.format,
    size: bytes.length,
    parts,
    createdBy: by.uid,
    createdByName: by.callsign.slice(0, 24),
    createdAt: serverTimestamp(),
  });
  return id;
}

export function subscribeSharedMaps(
  teamId: string,
  onMaps: (m: SharedMap[]) => void,
  onError: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    collection(firestore(), 'teams', teamId, 'maps'),
    (s) => {
      onMaps(
        s.docs
          .map((d) => {
            const v = d.data({ serverTimestamps: 'estimate' });
            return {
              id: d.id,
              name: typeof v.name === 'string' ? v.name : 'Карта',
              format: v.format as OverlayFormat,
              size: typeof v.size === 'number' ? v.size : 0,
              parts: typeof v.parts === 'number' ? v.parts : 0,
              createdBy: v.createdBy,
              createdByName: v.createdByName ?? '',
              createdAt: v.createdAt?.toMillis?.() ?? Date.now(),
            };
          })
          .filter((m) => FORMATS.includes(m.format) && m.parts > 0)
          .sort((a, b) => b.createdAt - a.createdAt)
      );
    },
    onError
  );
}

/** The file of a shared map, put back together from its parts. */
export async function fetchSharedMap(teamId: string, m: SharedMap): Promise<Uint8Array> {
  const s = await getDocs(collection(firestore(), 'teams', teamId, 'maps', m.id, 'parts'));
  const parts = s.docs.map((d) => d.data()).sort((a, b) => a.i - b.i);
  if (parts.length !== m.parts) throw new Error('Карта загружена не полностью, попробуйте позже');
  return fromBase64(parts.map((p) => p.data as string).join(''));
}

/** "Delete my data": maps this player shared with the squad. */
export async function deleteMyMaps(teamId: string, uid: string): Promise<void> {
  const s = await getDocs(query(collection(firestore(), 'teams', teamId, 'maps'), where('createdBy', '==', uid)));
  for (const d of s.docs) {
    const parts = typeof d.data().parts === 'number' ? d.data().parts : 0;
    await unshareMap(teamId, { id: d.id, parts } as SharedMap);
  }
}

/** Removes a map from the squad (author or a superior; the rules decide). */
export async function unshareMap(teamId: string, m: SharedMap): Promise<void> {
  await deleteDoc(doc(firestore(), 'teams', teamId, 'maps', m.id));
  for (let i = 0; i < m.parts; i++) {
    await deleteDoc(doc(firestore(), 'teams', teamId, 'maps', m.id, 'parts', String(i).padStart(2, '0'))).catch(() => {});
  }
}
