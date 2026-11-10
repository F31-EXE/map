/**
 * Offline schematic regions in the browser (desktop Chrome / Edge). GitHub release files
 * can't be fetched by a page (no CORS), so a region is downloaded as an ordinary file
 * and then added with a file picker; it's copied into the browser's private storage
 * (OPFS) and read from there by range. The region list is published next to the web
 * app (regions.json, copied by .github/workflows/web.yml).
 */
import { toBase64 } from '../lib/base64';

type Dir = {
  getDirectoryHandle(n: string, o?: { create?: boolean }): Promise<Dir>;
  getFileHandle(n: string, o?: { create?: boolean }): Promise<{
    getFile(): Promise<File>;
    createWritable(): Promise<WritableStream<Uint8Array>>;
  }>;
  removeEntry(n: string): Promise<void>;
};
const storage = (typeof navigator !== 'undefined' ? navigator.storage : undefined) as
  | (StorageManager & { getDirectory?: () => Promise<Dir> })
  | undefined;

export const REGIONS_SUPPORTED = Boolean(storage?.getDirectory);
/** Phones download straight into the app; browsers go through a downloaded file. */
export const DIRECT_DOWNLOAD = false;

const base = (process.env.EXPO_BASE_URL ?? '').replace(/\/$/, '');
export const INDEX_URL = `${base}/regions.json`;

export type RegionInfo = {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  maxzoom: number;
  bytes: number;
  build: string;
  url: string;
};

export async function fetchIndex(): Promise<RegionInfo[]> {
  let r: Response;
  try {
    r = await fetch(INDEX_URL, { cache: 'no-cache' });
  } catch {
    throw new Error('Нет интернета: список регионов появится, когда будет сеть. Скачанные схемы работают');
  }
  if (!r.ok) throw new Error(`Список регионов недоступен (${r.status})`);
  const data = (await r.json()) as { regions?: RegionInfo[] };
  return (data.regions ?? []).filter((x) => x && typeof x.id === 'string' && Array.isArray(x.bbox) && x.bbox.length === 4);
}

async function dir(): Promise<Dir> {
  if (!storage?.getDirectory) throw new Error('Этот браузер не хранит карты: откройте в Chrome или Edge');
  return (await storage.getDirectory()).getDirectoryHandle('regions', { create: true });
}

export type Progress = { received: number; total: number };

/** Not used in the browser (see importRegionFile); kept for the shared interface. */
export class RegionDownload {
  readonly region: RegionInfo;
  constructor(region: RegionInfo, _onProgress: (p: Progress) => void) {
    this.region = region;
  }
  async start(): Promise<boolean> {
    openRegionDownload(this.region);
    return false;
  }
  async resume(): Promise<boolean> {
    return false;
  }
  async pause(): Promise<void> {}
  cancel(): void {}
}

/** Starts the browser's own download of a region file. */
export function openRegionDownload(region: RegionInfo): void {
  const a = document.createElement('a');
  a.href = region.url;
  a.download = `${region.id}.pmtiles`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Lets the user pick a file (from a click). */
function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pmtiles';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * Copies a downloaded region file into the browser's storage. Returns false when the
 * user closed the picker. Must be called from a click.
 */
export async function importRegionFile(id: string, onProgress: (p: Progress) => void): Promise<boolean> {
  const file = await pickFile();
  if (!file) return false;
  const head = new Uint8Array(await file.slice(0, 7).arrayBuffer());
  if (String.fromCharCode(...head) !== 'PMTiles') throw new Error('Это не файл схемы (.pmtiles)');
  // Ask the browser not to evict our maps when the disk gets full.
  storage?.persist?.().catch(() => false);
  const handle = await (await dir()).getFileHandle(`${id}.pmtiles`, { create: true });
  const out = await handle.createWritable();
  let received = 0;
  const count = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      received += chunk.length;
      onProgress({ received, total: file.size });
      ctl.enqueue(chunk);
    },
  });
  await file.stream().pipeThrough(count).pipeTo(out);
  files.delete(id);
  return true;
}

export function removeRegion(id: string): void {
  files.delete(id);
  dir()
    .then((d) => d.removeEntry(`${id}.pmtiles`))
    .catch(() => {});
}

/** The stored list is trusted in the browser; a missing file shows up as a read error. */
export function hasRegionFile(_id: string): boolean {
  return REGIONS_SUPPORTED;
}

const files = new Map<string, Promise<File>>();

/** Bytes [offset, offset + length) of a region file, base64-encoded for the map page. */
export async function readRange(id: string, offset: number, length: number): Promise<string> {
  let f = files.get(id);
  if (!f) {
    f = dir().then((d) => d.getFileHandle(`${id}.pmtiles`)).then((h) => h.getFile());
    files.set(id, f);
    f.catch(() => files.delete(id));
  }
  const bytes = new Uint8Array(await (await f).slice(offset, offset + length).arrayBuffer());
  return toBase64(bytes);
}
