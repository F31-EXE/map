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
};

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

export type MarkerKind =
  | 'enemy'
  | 'friendly'
  | 'objective'
  | 'danger'
  | 'rally'
  | 'medic'
  | 'note'
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
