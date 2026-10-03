import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import JSZip from 'jszip';

import { unpackKmz } from '../src/lib/kmz.ts';

export const SAMPLE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
<Document>
  <Style id="zone"><LineStyle><color>ff0000ff</color><width>3</width></LineStyle><PolyStyle><color>400000ff</color></PolyStyle></Style>
  <GroundOverlay>
    <name>Полигон</name>
    <Icon><href>files/map%20tile.png</href></Icon>
    <LatLonBox><north>55.76</north><south>55.74</south><east>37.64</east><west>37.60</west><rotation>15</rotation></LatLonBox>
  </GroundOverlay>
  <Placemark><name>Красная зона</name><styleUrl>#zone</styleUrl>
    <Polygon><outerBoundaryIs><LinearRing><coordinates>37.61,55.745 37.63,55.745 37.63,55.755 37.61,55.755 37.61,55.745</coordinates></LinearRing></outerBoundaryIs></Polygon>
  </Placemark>
  <Placemark><name>Штаб</name><Point><coordinates>37.62,55.75,0</coordinates></Point></Placemark>
</Document>
</kml>`;

export async function buildSampleKmz(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('doc.kml', SAMPLE_KML);
  zip.file('files/map tile.png', readFileSync(new URL('../assets/icon.png', import.meta.url)));
  zip.file('files/readme.txt', 'ignored');
  return zip.generateAsync({ type: 'uint8array' });
}

test('unpackKmz extracts doc.kml and images as data URIs', async () => {
  const payload = await unpackKmz(await buildSampleKmz());
  assert.equal(payload.format, 'kml');
  assert.match(payload.data, /<GroundOverlay>/);
  assert.deepEqual(Object.keys(payload.assets ?? {}), ['files/map tile.png']);
  assert.match(payload.assets!['files/map tile.png'], /^data:image\/png;base64,iVBOR/);
});

test('unpackKmz falls back to the shallowest .kml when doc.kml is absent', async () => {
  const zip = new JSZip();
  zip.file('nested/deep/other.kml', '<kml>deep</kml>');
  zip.file('main.kml', '<kml>main</kml>');
  const payload = await unpackKmz(await zip.generateAsync({ type: 'uint8array' }));
  assert.equal(payload.data, '<kml>main</kml>');
});

test('unpackKmz rejects archives without KML', async () => {
  const zip = new JSZip();
  zip.file('a.png', 'x');
  await assert.rejects(unpackKmz(await zip.generateAsync({ type: 'uint8array' })), /нет KML/);
});
