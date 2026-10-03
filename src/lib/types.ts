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
};

export type Member = {
  id: string;
  callsign: string;
  color: string;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  updatedAt: number | null;
};

export type MarkerKind = 'enemy' | 'friendly' | 'objective' | 'danger' | 'rally' | 'medic' | 'note';

export type TacMarker = {
  id: string;
  kind: MarkerKind;
  label: string;
  lat: number;
  lng: number;
  createdBy: string;
  createdByName: string;
  createdAt: number;
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
