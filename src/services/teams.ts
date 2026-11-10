import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';

import { firestore } from '../lib/firebase';
import { normalizeCode } from '../lib/invite';
import { DEFAULT_TEAM_COLOR, roleOf, type RoleId } from '../lib/roles';
import { MAX_FACTIONS, type Faction } from '../lib/game';
import { validZone, type HotZone } from '../lib/hotzone';
import { validWave, type Wave } from '../lib/waves';
import type { LatLng, Member, MemberStatus, PinnedMessage, SelfPosition, TacMarker, Team } from '../lib/types';

// No 0/O/1/I/L to keep codes easy to dictate over the radio.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode(length = 6): string {
  let s = '';
  for (let i = 0; i < length; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

export { normalizeCode };

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
  profile: { callsign?: string; role?: RoleId; status?: MemberStatus; range?: number }
): Promise<void> {
  await updateDoc(doc(firestore(), 'teams', teamId, 'members', uid), profile);
}

/** A commander sets the role or status of someone below them (enforced by rules). */
export async function updateMemberByCommander(
  teamId: string,
  memberId: string,
  patch: { role?: RoleId; status?: MemberStatus }
): Promise<void> {
  await updateDoc(doc(firestore(), 'teams', teamId, 'members', memberId), patch);
}

/** A photo for a photo marker: a compressed JPEG data URI in its own doc. */
export async function savePhoto(teamId: string, photoId: string, uid: string, data: string): Promise<void> {
  await setDoc(doc(firestore(), 'teams', teamId, 'photos', photoId), {
    data,
    createdBy: uid,
    createdAt: serverTimestamp(),
  });
}

export async function loadPhoto(teamId: string, photoId: string): Promise<string | null> {
  const d = await getDoc(doc(firestore(), 'teams', teamId, 'photos', photoId));
  const v = d.data();
  return typeof v?.data === 'string' ? v.data : null;
}

export async function deletePhoto(teamId: string, photoId: string): Promise<void> {
  await deleteDoc(doc(firestore(), 'teams', teamId, 'photos', photoId));
}

/** "Delete my data": every photo this player took in the squad. */
export async function deleteMyPhotos(teamId: string, uid: string): Promise<void> {
  const s = await getDocs(query(collection(firestore(), 'teams', teamId, 'photos'), where('createdBy', '==', uid)));
  await Promise.all(s.docs.map((d) => deleteDoc(d.ref)));
}

/** Commanders set where square А1 of the snail grid starts (NW corner); null resets. */
export async function setGridOrigin(teamId: string, grid: LatLng | null): Promise<void> {
  await updateDoc(doc(firestore(), 'teams', teamId), { grid });
}

/** Commanders pin a chat message for the squad; null unpins. */
export async function setPinned(teamId: string, pinned: PinnedMessage | null): Promise<void> {
  await updateDoc(doc(firestore(), 'teams', teamId), { pinned });
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

export type PowerInfo = { battery: number | null; charging: boolean; radioBattery: number | null };

export async function publishPosition(teamId: string, uid: string, p: SelfPosition, power?: PowerInfo): Promise<void> {
  await updateDoc(doc(firestore(), 'teams', teamId, 'members', uid), {
    lat: p.lat,
    lng: p.lng,
    accuracy: p.accuracy,
    heading: p.heading,
    // Rides along with positions: no extra writes.
    ...(power ? { battery: power.battery, charging: power.charging, radioBattery: power.radioBattery } : {}),
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
          ? {
              id: s.id,
              name: d.name,
              code: d.code,
              ownerId: d.ownerId,
              color: d.color ?? DEFAULT_TEAM_COLOR,
              sideId: typeof d.sideId === 'string' ? d.sideId : null,
              recordingId: typeof d.recordingId === 'string' ? d.recordingId : null,
              pinned: d.pinned && typeof d.pinned.text === 'string' ? (d.pinned as PinnedMessage) : null,
              factions: parseFactions(d.factions),
              grid:
                d.grid && Number.isFinite(d.grid.lat) && Number.isFinite(d.grid.lng)
                  ? { lat: d.grid.lat, lng: d.grid.lng }
                  : null,
            }
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
            status: v.status === 'dead' || v.status === 'afk' ? v.status : 'alive',
            lat: typeof v.lat === 'number' ? v.lat : null,
            lng: typeof v.lng === 'number' ? v.lng : null,
            heading: typeof v.heading === 'number' ? v.heading : null,
            updatedAt: millis(v.updatedAt),
            faction: Number.isInteger(v.faction) ? v.faction : null,
            pts: parsePoints(v.pts),
            range: typeof v.range === 'number' ? v.range : null,
            battery: typeof v.battery === 'number' ? v.battery : null,
            charging: v.charging === true,
            radioBattery: typeof v.radioBattery === 'number' ? v.radioBattery : null,
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
            audience: v.audience === 'commanders' ? 'commanders' : undefined,
            groupId: typeof v.groupId === 'string' ? v.groupId : undefined,
            teamId,
            staleVotes: Array.isArray(v.staleVotes) ? v.staleVotes : [],
            doneVotes: Array.isArray(v.doneVotes) ? v.doneVotes : [],
            points: Array.isArray(v.points) ? v.points : undefined,
            color: typeof v.color === 'string' ? v.color : undefined,
            wave: validWave(v.wave) ? { every: v.wave.every, start: v.wave.start } : null,
            zone: validZone(v.zone) ? pickZone(v.zone) : null,
            faction: Number.isInteger(v.faction) ? v.faction : null,
            photoId: typeof v.photoId === 'string' ? v.photoId : undefined,
            heading: typeof v.heading === 'number' ? v.heading : null,
          };
        })
      );
    },
    onError
  );
}

function parseFactions(f: unknown): Faction[] | undefined {
  if (!Array.isArray(f) || !f.length) return undefined;
  return f
    .slice(0, MAX_FACTIONS)
    .map((x, i) => ({
      name: typeof x?.name === 'string' ? x.name.slice(0, 24) : `Команда ${i + 1}`,
      color: typeof x?.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(x.color) ? x.color : '#C3CCC6',
    }));
}

function parsePoints(p: unknown): Record<string, number> | undefined {
  if (!p || typeof p !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
}

/** Game master: split players into teams (null ends the team game). */
export async function setFactions(teamId: string, factions: Faction[] | null): Promise<void> {
  await updateDoc(doc(firestore(), 'teams', teamId), { factions });
}

/** Game master: put a player into a team (null: no team). */
export async function setMemberFaction(teamId: string, memberId: string, faction: number | null): Promise<void> {
  await updateDoc(doc(firestore(), 'teams', teamId, 'members', memberId), { faction });
}

/** A player adds the points they earned this minute in a control zone. */
export async function addPoints(teamId: string, uid: string, zoneId: string, n: number): Promise<void> {
  await updateDoc(doc(firestore(), 'teams', teamId, 'members', uid), { [`pts.${zoneId}`]: increment(n) });
}

function pickZone(z: HotZone): HotZone {
  return { r: z.r, hot: z.hot, every: z.every, start: z.start, seed: z.seed };
}

/** New marker id, made on the phone so the same id can travel over Bluetooth. */
export function newMarkerId(teamId: string): string {
  return doc(collection(firestore(), 'teams', teamId, 'markers')).id;
}

export async function addTeamMarker(
  teamId: string,
  m: Pick<
    TacMarker,
    'kind' | 'label' | 'lat' | 'lng' | 'createdBy' | 'createdByName' | 'points' | 'color' | 'wave' | 'zone' | 'faction' | 'photoId' | 'heading'
  >,
  id = newMarkerId(teamId)
): Promise<void> {
  const { points, color, wave, zone, faction, photoId, heading, ...rest } = m;
  await setDoc(doc(firestore(), 'teams', teamId, 'markers', id), {
    ...rest,
    ...(points ? { points } : {}),
    ...(color ? { color } : {}),
    ...(wave ? { wave } : {}),
    ...(zone ? { zone } : {}),
    ...(faction != null ? { faction } : {}),
    ...(photoId ? { photoId } : {}),
    ...(heading != null ? { heading } : {}),
    createdAt: serverTimestamp(),
  });
}

/**
 * Gateway: a marker that reached this phone over Bluetooth goes to the server on its
 * author's behalf (rules check `relayedBy` and the author's membership and rights).
 * Refused if the author or another phone already uploaded it.
 */
export async function relayTeamMarker(teamId: string, relayedBy: string, m: TacMarker): Promise<void> {
  await setDoc(doc(firestore(), 'teams', teamId, 'markers', m.id), {
    kind: m.kind,
    label: m.label,
    lat: m.lat,
    lng: m.lng,
    createdBy: m.createdBy,
    createdByName: m.createdByName,
    ...(m.points ? { points: m.points } : {}),
    ...(m.color ? { color: m.color } : {}),
    ...(m.faction != null ? { faction: m.faction } : {}),
    ...(m.photoId ? { photoId: m.photoId } : {}),
    ...(m.heading != null ? { heading: m.heading } : {}),
    createdAt: Timestamp.fromMillis(m.createdAt),
    relayedBy,
  });
}

/** "No longer relevant" / "done" vote; each player counts once. */
export async function voteMarker(teamId: string, markerId: string, uid: string, vote: 'stale' | 'done'): Promise<void> {
  await updateDoc(doc(firestore(), 'teams', teamId, 'markers', markerId), {
    [vote === 'stale' ? 'staleVotes' : 'doneVotes']: arrayUnion(uid),
  });
}

/** Commanders set (or clear) the respawn departure schedule on a respawn marker. */
export async function setMarkerWave(teamId: string, markerId: string, wave: Wave | null): Promise<void> {
  await updateDoc(doc(firestore(), 'teams', teamId, 'markers', markerId), { wave });
}

/** Commanders change the control zone / hot zone settings. */
export async function setMarkerZone(teamId: string, markerId: string, zone: HotZone): Promise<void> {
  await updateDoc(doc(firestore(), 'teams', teamId, 'markers', markerId), { zone });
}

/** The author moves their own marker (enforced by rules). */
export async function moveTeamMarker(teamId: string, markerId: string, lat: number, lng: number): Promise<void> {
  await updateDoc(doc(firestore(), 'teams', teamId, 'markers', markerId), { lat, lng });
}

export async function deleteTeamMarker(teamId: string, markerId: string): Promise<void> {
  await deleteDoc(doc(firestore(), 'teams', teamId, 'markers', markerId));
}

/**
 * Deletes several markers; each delete is checked by the rules on its own, so one
 * refusal doesn't stop the rest. Returns how many could not be deleted.
 */
export async function deleteTeamMarkers(teamId: string, markerIds: string[]): Promise<number> {
  const results = await Promise.allSettled(markerIds.map((id) => deleteTeamMarker(teamId, id)));
  return results.filter((r) => r.status === 'rejected').length;
}

/** Message for a refused marker change. */
export function markerErrorText(e: unknown): string {
  if (isPermissionDenied(e)) {
    return 'Сервер не разрешил. Метку поставил вышестоящий командир, либо в Firebase опубликованы старые правила доступа (firestore.rules).';
  }
  return (e as Error).message;
}
