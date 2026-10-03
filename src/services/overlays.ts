import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';

import { extOf, unpackKmz, type OverlayPayload } from '../lib/kmz';
import { KEYS, loadJson, newId, saveJson } from '../lib/storage';
import type { OverlayFormat, OverlayMeta } from '../lib/types';

export type { OverlayPayload };

function overlaysDir(): Directory {
  const dir = new Directory(Paths.document, 'overlays');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function detectFormat(fileName: string): OverlayFormat | null {
  switch (extOf(fileName)) {
    case 'kmz':
      return 'kmz';
    case 'kml':
      return 'kml';
    case 'gpx':
      return 'gpx';
    case 'geojson':
    case 'json':
      return 'geojson';
    default:
      return null;
  }
}

export async function listOverlays(): Promise<OverlayMeta[]> {
  return loadJson<OverlayMeta[]>(KEYS.overlays, []);
}

export async function saveOverlays(list: OverlayMeta[]): Promise<void> {
  await saveJson(KEYS.overlays, list);
}

/** Lets the user pick a KMZ/KML/GPX/GeoJSON file and copies it into app storage. */
export async function pickAndImportOverlay(): Promise<OverlayMeta | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  const format = detectFormat(asset.name);
  if (!format) {
    throw new Error(`Формат «${asset.name}» не поддерживается. Нужен KMZ, KML, GPX или GeoJSON.`);
  }
  const id = newId();
  const fileName = `${id}.${format}`;
  const src = new File(asset.uri);
  await src.copy(new File(overlaysDir(), fileName));

  const meta: OverlayMeta = {
    id,
    name: asset.name.replace(/\.[^.]+$/, ''),
    format,
    fileName,
    visible: true,
    addedAt: Date.now(),
  };
  // Validate early so a broken file never lands in the list.
  await loadOverlayPayload(meta);
  return meta;
}

export function deleteOverlayFile(meta: OverlayMeta): void {
  const f = new File(overlaysDir(), meta.fileName);
  if (f.exists) f.delete();
}

export async function loadOverlayPayload(meta: OverlayMeta): Promise<OverlayPayload> {
  const file = new File(overlaysDir(), meta.fileName);
  if (!file.exists) throw new Error(`Файл карты «${meta.name}» не найден`);

  if (meta.format === 'kmz') return unpackKmz(await file.bytes());
  const text = await file.text();
  if (meta.format === 'geojson') JSON.parse(text);
  return { format: meta.format, data: text };
}
