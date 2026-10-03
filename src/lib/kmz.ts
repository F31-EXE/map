import JSZip from 'jszip';

/** What the WebView needs to draw an overlay. KMZ is unpacked to KML + data-URI images. */
export type OverlayPayload = {
  format: 'kml' | 'gpx' | 'geojson';
  data: string;
  assets?: Record<string, string>;
};

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export async function unpackKmz(bytes: Uint8Array): Promise<OverlayPayload> {
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  const kmlEntries = entries.filter((f) => extOf(f.name) === 'kml');
  if (!kmlEntries.length) throw new Error('В KMZ нет KML-файла');
  // By convention the root document is doc.kml; otherwise take the shallowest .kml.
  const root =
    kmlEntries.find((f) => f.name.toLowerCase() === 'doc.kml') ??
    [...kmlEntries].sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0];

  const assets: Record<string, string> = {};
  for (const f of entries) {
    const mime = IMAGE_MIME[extOf(f.name)];
    if (mime) assets[f.name] = `data:${mime};base64,${await f.async('base64')}`;
  }
  return { format: 'kml', data: await root.async('string'), assets };
}
