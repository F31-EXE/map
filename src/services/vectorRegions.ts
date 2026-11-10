/**
 * Offline schematic maps by region (like 2GIS city downloads): one PMTiles file of
 * OpenStreetMap vector data per Russian region, built by .github/workflows/offline-regions.yml
 * and published on the GitHub release `offline-regions` with an index (regions.json).
 * Files live in <documents>/regions/<id>.pmtiles; the map page reads them through
 * `readRange` (it can't read byte ranges of local files itself).
 */
import { Directory, DownloadTask, File, FileMode, Paths, type FileHandle } from 'expo-file-system';
import { Platform } from 'react-native';

import { toBase64 } from '../lib/base64';

export const REGIONS_SUPPORTED = Platform.OS !== 'web';
/** Phones download straight into the app; browsers go through a downloaded file. */
export const DIRECT_DOWNLOAD = true;

const BASE = 'https://github.com/F31-EXE/map/releases/download/offline-regions';
export const INDEX_URL = `${BASE}/regions.json`;

export type RegionInfo = {
  id: string;
  name: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  maxzoom: number;
  bytes: number;
  /** Protomaps build date (YYYYMMDD): a newer one means an update is available. */
  build: string;
  url: string;
};

export async function fetchIndex(): Promise<RegionInfo[]> {
  let r: Response;
  try {
    r = await fetch(INDEX_URL, { headers: { 'Cache-Control': 'no-cache' } });
  } catch {
    throw new Error('Нет интернета: список регионов появится, когда будет сеть. Скачанные схемы работают');
  }
  if (!r.ok) throw new Error(`Список регионов недоступен (${r.status})`);
  const data = (await r.json()) as { regions?: RegionInfo[] };
  return (data.regions ?? []).filter((x) => x && typeof x.id === 'string' && Array.isArray(x.bbox) && x.bbox.length === 4);
}

function dir(): Directory {
  const d = new Directory(Paths.document, 'regions');
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

export const regionFile = (id: string) => new File(dir(), `${id}.pmtiles`);
const partFile = (id: string) => new File(dir(), `${id}.part`);

export type Progress = { received: number; total: number };

/**
 * A region download that can be paused and resumed while the app runs. `start()`
 * resolves with true when the file is complete, false when paused or cancelled.
 */
export class RegionDownload {
  private task: DownloadTask;

  constructor(
    readonly region: RegionInfo,
    onProgress: (p: Progress) => void
  ) {
    const part = partFile(region.id);
    if (part.exists) part.delete();
    this.task = new DownloadTask(region.url, part, {
      onProgress: (p) => onProgress({ received: p.bytesWritten, total: p.totalBytes > 0 ? p.totalBytes : region.bytes }),
    });
  }

  async start(): Promise<boolean> {
    return this.finish(await this.task.downloadAsync());
  }

  async resume(): Promise<boolean> {
    return this.finish(await this.task.resumeAsync());
  }

  pause(): Promise<void> {
    return this.task.pauseAsync();
  }

  cancel(): void {
    this.task.cancel();
    const part = partFile(this.region.id);
    if (part.exists) part.delete();
  }

  private finish(file: File | null): boolean {
    if (!file) return false;
    closeHandle(this.region.id);
    const final = regionFile(this.region.id);
    if (final.exists) final.delete();
    file.move(final);
    return true;
  }
}

export function removeRegion(id: string): void {
  closeHandle(id);
  for (const f of [regionFile(id), partFile(id)]) if (f.exists) f.delete();
}

export function hasRegionFile(id: string): boolean {
  return REGIONS_SUPPORTED && regionFile(id).exists;
}

// Open read handles, one per region file.
const handles = new Map<string, FileHandle>();

function closeHandle(id: string) {
  const h = handles.get(id);
  if (!h) return;
  handles.delete(id);
  try {
    h.close();
  } catch {
    // Already closed.
  }
}

/** Bytes [offset, offset + length) of a region file, base64-encoded for the map page. */
export function readRange(id: string, offset: number, length: number): string {
  let h = handles.get(id);
  if (!h) {
    h = regionFile(id).open(FileMode.ReadOnly);
    handles.set(id, h);
  }
  h.offset = offset;
  return toBase64(h.readBytes(length));
}

/** Browser only (see vectorRegions.web.ts). */
export function openRegionDownload(_region: RegionInfo): void {}

/** Browser only (see vectorRegions.web.ts). */
export async function importRegionFile(_id: string, _onProgress: (p: Progress) => void): Promise<boolean> {
  return false;
}
