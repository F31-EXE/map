import AsyncStorage from '@react-native-async-storage/async-storage';

export const KEYS = {
  callsign: 'tacmap.callsign',
  teamId: 'tacmap.teamId',
  shareLocation: 'tacmap.shareLocation',
  baseLayer: 'tacmap.baseLayer',
  soloMarkers: 'tacmap.soloMarkers',
  overlays: 'tacmap.overlays',
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
