import type { RoleId } from './roles';
import type { Faction } from './game';
import type { HotZone } from './hotzone';
import type { Ball } from './gameModes';
import type { Wave } from './waves';

export type LatLng = { lat: number; lng: number };

export type SelfPosition = LatLng & {
  accuracy: number | null;
  heading: number | null;
  timestamp: number;
  /** Whose GPS: the phone's or the Meshtastic radio's (src/lib/gpsSource.ts). */
  source?: 'phone' | 'radio';
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
  /** Direction of that side the squad joined (its commander leads several squads). */
  dirId?: string | null;
  /** Movement recording in progress, if any. */
  recordingId?: string | null;
  /** Chat message pinned by a commander. */
  pinned?: PinnedMessage | null;
  /** Team game: the teams players are split into (set by the creator as game master). */
  factions?: Faction[];
  /** Snail grid: NW corner of square А1, set by a commander for the whole squad. */
  grid?: LatLng | null;
  /** Commander's briefing for the game: task, time, points; members mark it read. */
  briefing?: Briefing | null;
};

/** `at` identifies the version: a member has read it when their `briefRead` equals it. */
export type Briefing = { text: string; time: string | null; points: string[]; by: string; byName: string; at: number };

/** Grid over the map: none, UTM kilometre squares, or 500 m squares with the snail. */
export type GridMode = 'off' | 'utm' | 'snail';

export type PinnedMessage = { id: string; text: string; callsign: string; uid: string; at: number };

/** Fighter's game state, set by themselves or a superior. */
export type MemberStatus = 'alive' | 'dead' | 'afk';

/** A side: several squads under one side commander. */
export type Side = {
  id: string;
  name: string;
  code: string;
  ownerId: string;
  /** Big game this side plays in. */
  gameId?: string | null;
  /** Made by a game tech: the code a commander uses to take it over. */
  claim?: string | null;
  /** Deputies the commander named, with the rights the commander gave each. */
  deputies?: Record<string, Deputy>;
  /** Directions: a commander over several squads (squads join one with its code). */
  directions?: Record<string, Direction>;
  /** Code people join the side's HQ with (then the commander gives roles). */
  hqCode?: string | null;
};

/** What a deputy may do besides seeing the whole side: */
export type DeputyPerm = 'orders' | 'game' | 'squads' | 'directions';
export type Deputy = { name: string; perms: DeputyPerm[] };
export type Direction = { name: string; cmd: string | null; cmdName: string | null; code: string };
/** Someone in a side's HQ (joined with the HQ code), with their last position. */
export type HqPerson = {
  uid: string;
  callsign: string;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  updatedAt: number | null;
};

/** A big game run by game techs (organizers), above sides. */
export type Game = {
  id: string;
  name: string;
  ownerId: string;
  /** Code for more techs to join (same rights as the creator). */
  techCode: string;
  /** Code for side commanders to bring their side into the game. */
  sideCode: string;
  /** Tickets mode: lives per side at the start (null = off). */
  tickets: number | null;
  match: { start: number; minutes: number; stoppedAt?: number | null; pausedAt?: number | null } | null;
  /** Territories: equal sectors at the end are a draw, or go to the longer holder. */
  tiebreak: 'draw' | 'time';
};

export type GameTech = {
  uid: string;
  callsign: string;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  updatedAt: number | null;
};

/** A side as the game sees it (score board), with its commander for techs. */
export type GameSide = {
  id: string;
  name: string;
  color: string;
  tickets?: number;
  /** SQUAD mode: resources in the side's HQ (null before the first match). */
  res?: number | null;
};

export type GamePlayer = {
  uid: string;
  sideId: string;
  teamId: string | null;
  callsign: string;
  pts: Record<string, number>;
  deaths: number;
  cell: string | null;
  cellAt: number | null;
  /** SQUAD mode: resources in the fighter's pack. */
  carry?: number;
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
  /** Last position came over Bluetooth, not from the server. */
  viaMesh?: boolean;
  /** Team game: index into the squad's `factions`. */
  faction?: number | null;
  /** Team game: points earned per control zone (marker id). */
  pts?: Record<string, number>;
  /** Mortar crews: maximum range in meters (circle on the map). */
  range?: number | null;
  /** Phone (or laptop) battery %, and whether it's charging. */
  battery?: number | null;
  charging?: boolean;
  /** Meshtastic radio battery %, 101 = on external power. */
  radioBattery?: number | null;
  /** Whose GPS the position is from, and its accuracy (m). */
  gpsSrc?: 'phone' | 'radio' | null;
  accuracy?: number | null;
  /** Side hierarchy stars: 3 side commander, 2 deputy, 1 direction commander. */
  stars?: 0 | 1 | 2 | 3;
  /** Map label instead of callsign and role (side view: the squad's name on its commander). */
  mapLabel?: string;
  /** A game tech (organizer): drawn as an orange diamond. */
  tech?: boolean;
  /** Team tag shown before the callsign, up to 5 characters. */
  tag?: string | null;
  /** `at` of the squad briefing this fighter has read. */
  briefRead?: number | null;
  /** Asked for help (SOS) and not cancelled yet: pulses red on the map. */
  sos?: boolean;
  /** A tracker radio (no phone): its node number; id is `trk/<hex>`. */
  tracker?: number;
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
  | 'hotzone'
  | 'area-dead'
  | 'area-enemy'
  | 'area-bound'
  | 'photo'
  | 'flag'
  | 'sector'
  | 'ball'
  // SQUAD mode: HQs and mines (techs), buildings (side commanders), strikes and scans.
  | 'hq'
  | 'mine'
  | 'b-fob'
  | 'b-reb'
  | 'b-recon'
  | 'b-air'
  | 'b-depot'
  | 'strike'
  | 'scan'
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
  /** Heard over Bluetooth only, not (yet) on the server. */
  viaMesh?: boolean;
  /** Respawn departures (respawn / dead-zone markers), set by commanders. */
  wave?: Wave | null;
  /** Control zone with a moving hot zone (`hotzone` markers), set by commanders. */
  zone?: HotZone | null;
  /** Team game: placed by a player of this team, shown only to that team. */
  faction?: number | null;
  /** Photo marker: id of the picture in the squad's photos (team markers). */
  photoId?: string;
  /** Photo marker kept on this phone only: the picture itself (data URI). */
  photoData?: string;
  /** Photo marker: compass direction the camera faced. */
  heading?: number | null;
  /** Game flag / territory sector: side holding it and the capture history. */
  owner?: string | null;
  /** Territory sector: a capture under way (side, minutes of advantage so far). */
  cap?: { s: string; n: number } | null;
  /** Flag: a side outnumbering the others at it since `t` (taken after 30 s). */
  fcap?: { s: string; t: number } | null;
  /** Territory sector: the last match minute the referee changed it in. */
  min?: number | null;
  log?: { s: string; t: number }[];
  /** SQUAD building: cost, resources in it, built, sides that found it, ability cooldown. */
  bld?: { cost: number; paid: number; built: boolean; seen: string[]; ready?: number | null } | null;
  /** SQUAD mine: a side holding the majority there since `t`; captures blocked until `block`. */
  mcap?: { s: string; t: number } | null;
  block?: number | null;
  /** SQUAD strike / scan order: when it lands, and the referee's outcome. */
  hit?: { at: number; ok?: boolean; done?: boolean; void?: boolean; found?: LatLng[] } | null;
  /** Football ball (`owner` = its side, `points` = its arrow): how far it has rolled. */
  ball?: Ball | null;
  /** Placed by a game tech for the whole game (not a squad marker). */
  gameId?: string;
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
  /** Squad map this file was shared as or received from (teams/{id}/maps). */
  sharedId?: string;
};
