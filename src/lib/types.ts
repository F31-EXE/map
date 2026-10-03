import type { RoleId } from './roles';

export type LatLng = { lat: number; lng: number };

export type SelfPosition = LatLng & {
  accuracy: number | null;
  heading: number | null;
  timestamp: number;
};

export type Team = {
  id: string;
  name: string;
  code: string;
  ownerId: string;
  /** Chosen by the commander; every teammate is drawn in it. */
  color: string;
  /** Side this squad is attached to, if any. */
  sideId: string | null;
  /** Movement recording in progress, if any. */
  recordingId?: string | null;
  /** Chat message pinned by a commander. */
  pinned?: PinnedMessage | null;
};

export type PinnedMessage = { id: string; text: string; callsign: string; uid: string; at: number };

/** Fighter's game state, set by themselves or a superior. */
export type MemberStatus = 'alive' | 'dead' | 'afk';

/** A side: several squads under one side commander. */
export type Side = {
  id: string;
  name: string;
  code: string;
  ownerId: string;
};

export type Member = {
  id: string;
  callsign: string;
  role: RoleId;
  /** May issue orders (granted by the team creator). */
  canCommand: boolean;
  status: MemberStatus;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  updatedAt: number | null;
  /** Display color override (side view: the squad's color). */
  color?: string;
  /** Squad leader or holds command rights (side view). */
  leader?: boolean;
  /** Squad the member belongs to (side view). */
  teamId?: string;
};

export type OrderKind = 'order-move' | 'order-attack' | 'order-defend';

/** Polygon infrastructure. */
export type AdminKind = 'respawn' | 'deadzone' | 'parking' | 'admin';

export type MarkerKind =
  | 'enemy'
  | 'friendly'
  | 'objective'
  | 'danger'
  | 'rally'
  | 'medic'
  | 'note'
  | 'arrow'
  | AdminKind
  | OrderKind;

export type TacMarker = {
  id: string;
  kind: MarkerKind;
  label: string;
  lat: number;
  lng: number;
  createdBy: string;
  createdByName: string;
  createdAt: number;
  /** Stored only on this device, never sent to the team. */
  personal?: boolean;
  /** Side orders go to squad commanders only. */
  audience?: 'commanders';
  /** Copies of one side order across squads share this id. */
  groupId?: string;
  /** Squad the marker lives in. */
  teamId?: string;
  /** Uids who voted "no longer relevant" / "done"; enough votes hide the marker. */
  staleVotes?: string[];
  doneVotes?: string[];
  /** Arrow: the path, start to tip (lat/lng is the tip). */
  points?: LatLng[];
  /** Arrow color (other kinds use their kind's color). */
  color?: string;
};

export type OverlayFormat = 'kml' | 'kmz' | 'gpx' | 'geojson';

export type OverlayMeta = {
  id: string;
  name: string;
  format: OverlayFormat;
  /** File name inside the app's overlays directory. */
  fileName: string;
  visible: boolean;
  addedAt: number;
};
