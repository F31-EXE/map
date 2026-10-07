import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { KEYS, loadJson, newId, saveJson } from '../lib/storage';
import { countTiles, splitToFit, tileExt, tilesOf, tileUrl, TILE_LAYERS, type Bounds } from '../lib/tiles';

/** A downloaded piece of a base layer, stored as tile files under offline/<id>/. */
export type OfflineArea = Bounds & {
  id: string;
  name: string;
  /** Base layer id (src/lib/tiles.ts). */
  layer: string;
  minZoom: number;
  maxZoom: number;
  tiles: number;
  /** Tiles that failed to download. */
  failed: number;
  bytes: number;
  createdAt: number;
  /** False while downloading or if the download was cut short. */
  complete: boolean;
};

export const OFFLINE_SUPPORTED = Platform.OS !== 'web';
/** One downloaded part: bigger regions are split into several (see planDownload). */
export const MAX_TILES = 20_000;
/** Whole region ceiling, about 3–5 GB of satellite tiles. */
export const MAX_TOTAL_TILES = 200_000;
const CONCURRENCY = 6;

function rootDir(): Directory {
  const dir = new Directory(Paths.document, 'offline');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** file:// URL of the tiles folder, with a trailing slash, for the map page. */
export function offlineRootUri(): string {
  const uri = rootDir().uri;
  return uri.endsWith('/') ? uri : `${uri}/`;
}

export async function listAreas(): Promise<OfflineArea[]> {
  return loadJson<OfflineArea[]>(KEYS.offlineAreas, []);
}

export async function saveAreas(list: OfflineArea[]): Promise<void> {
  await saveJson(KEYS.offlineAreas, list);
}

/**
 * How a region will be downloaded: split into parts of at most MAX_TILES tiles,
 * with the size estimate and whether it fits on the phone.
 */
export function planDownload(layer: string, b: Bounds, minZoom: number, maxZoom: number) {
  const def = TILE_LAYERS[layer];
  if (!def) return { parts: [] as Bounds[], tiles: 0, mb: 0, freeMb: null as number | null, fits: false };
  const top = Math.min(maxZoom, def.maxZoom);
  const tiles = countTiles(b, minZoom, top, def.crs) * def.urls.length;
  const parts = tiles > MAX_TOTAL_TILES ? [] : splitToFit(b, minZoom, top, def.crs, MAX_TILES, def.urls.length);
  const mb = Math.ceil((tiles * def.avgKb) / 1024);
  let freeMb: number | null = null;
  try {
    freeMb = Math.floor(Paths.availableDiskSpace / 1048576);
  } catch {
    // Not available (web).
  }
  // Leave room for the phone itself.
  const fits = tiles <= MAX_TOTAL_TILES && (freeMb == null || mb < freeMb - 1024);
  return { parts, tiles, mb, freeMb, fits };
}

export function newArea(layer: string, name: string, b: Bounds, minZoom: number, maxZoom: number): OfflineArea {
  const def = TILE_LAYERS[layer];
  return {
    ...b,
    id: newId(),
    name,
    layer,
    minZoom,
    maxZoom: Math.min(maxZoom, def?.maxZoom ?? maxZoom),
    tiles: 0,
    failed: 0,
    bytes: 0,
    createdAt: Date.now(),
    complete: false,
  };
}

/**
 * Downloads every tile of the area (coarse zooms first). Already present files are
 * skipped, so re-running resumes a cut-short download. `shouldStop` cancels.
 */
export async function downloadArea(
  area: OfflineArea,
  onProgress: (done: number, total: number) => void,
  shouldStop: () => boolean
): Promise<OfflineArea> {
  const def = TILE_LAYERS[area.layer];
  if (!def) throw new Error('Эту подложку нельзя скачать');
  const total = countTiles(area, area.minZoom, area.maxZoom, def.crs) * def.urls.length;
  if (total > MAX_TILES) throw new Error(`Слишком большой район: ${total} тайлов (максимум ${MAX_TILES}). Приблизьте карту.`);

  const base = new Directory(rootDir(), area.id);
  const madeDirs = new Set<string>();
  const dirFor = (i: number, z: number, x: number) => {
    const key = `${i}/${z}/${x}`;
    const dir = new Directory(base, String(i), String(z), String(x));
    if (!madeDirs.has(key)) {
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      madeDirs.add(key);
    }
    return dir;
  };

  const jobs = (function* () {
    for (const t of tilesOf(area, area.minZoom, area.maxZoom, def.crs)) {
      for (let i = 0; i < def.urls.length; i++) yield { t, i };
    }
  })();

  let done = 0;
  let failed = 0;
  let bytes = 0;
  const worker = async () => {
    for (;;) {
      if (shouldStop()) return;
      const next = jobs.next();
      if (next.done) return;
      const { t, i } = next.value;
      const url = def.urls[i];
      const file = new File(dirFor(i, t.z, t.x), `${t.y}.${tileExt(url)}`);
      try {
        if (!file.exists) await File.downloadFileAsync(tileUrl(url, t), file, { idempotent: true });
        bytes += file.size ?? 0;
      } catch {
        failed++;
      }
      done++;
      if (done % 10 === 0 || done === total) onProgress(done, total);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { ...area, tiles: done, failed, bytes, complete: done === total && !shouldStop() };
}

export function deleteAreaFiles(area: OfflineArea) {
  const dir = new Directory(rootDir(), area.id);
  try {
    if (dir.exists) dir.delete();
  } catch {
    // Already gone.
  }
}
