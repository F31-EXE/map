import AsyncStorage from '@react-native-async-storage/async-storage';

export const KEYS = {
  callsign: 'tacmap.callsign',
  teamId: 'tacmap.teamId',
  shareLocation: 'tacmap.shareLocation',
  baseLayer: 'tacmap.baseLayer',
  role: 'tacmap.role',
  avatar: 'tacmap.avatar',
  orderSound: 'tacmap.orderSound',
  // Historical key name: these used to be "solo" markers.
  personalMarkers: 'tacmap.soloMarkers',
  overlays: 'tacmap.overlays',
  sideId: 'tacmap.sideId',
  sideColors: 'tacmap.sideColors',
  sideShowAll: 'tacmap.sideShowAll',
  grid: 'tacmap.grid',
  status: 'tacmap.status',
  mesh: 'tacmap.mesh',
  keepAwake: 'tacmap.keepAwake',
  offlineAreas: 'tacmap.offlineAreas',
  background: 'tacmap.background',
  pendingTracks: 'tacmap.pendingTracks',
  /** The first-launch "download your area" offer was shown. */
  regionPrompted: 'tacmap.regionPrompted',
  /** Team game: last scored minute per control zone. */
  zoneTicks: 'tacmap.zoneTicks',
  /** Active recording of the squad as last seen, for starting up without a connection. */
  recording: 'tacmap.recording',
  /** Mortar range and test shots (src/lib/mortar.ts). */
  mortar: 'tacmap.mortar',
  /** Fixed mortar firing position, or null to fire from the GPS position. */
  mortarPos: 'tacmap.mortarPos',
  /** Meshtastic radio picked in settings ({ id, name }), reconnected on start. */
  radio: 'tacmap.radio',
  /** Snail grid origin when not in a squad (in a squad it's on the team doc). */
  gridOrigin: 'tacmap.gridOrigin',
} as const;

export async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export async function saveJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
