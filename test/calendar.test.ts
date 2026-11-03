import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatFromName, parseMapPoints, toCalendarGame, upcomingWithMap } from '../src/lib/calendar';

test('parseMapPoints reads kinds, commas and labels, skips junk', () => {
  const pts = parseMapPoints('респ | 56.8389, 60.6057 | Респ синих\nмертвяк | 56,8401; 60,6102\nпарковка | 56.835 60.600\nмусор\nадмин | 999, 1');
  assert.deepEqual(pts, [
    { kind: 'respawn', lat: 56.8389, lng: 60.6057, label: 'Респ синих' },
    { kind: 'deadzone', lat: 56.8401, lng: 60.6102, label: '' },
    { kind: 'parking', lat: 56.835, lng: 60.6, label: '' },
  ]);
});

test('toCalendarGame decodes a Firestore REST document', () => {
  const g = toCalendarGame({
    name: 'projects/p/databases/(default)/documents/games/abc',
    fields: {
      title: { stringValue: 'Рубеж' },
      startDate: { stringValue: '2030-05-01T05:00:00Z' },
      mapUrl: { stringValue: 'https://firebasestorage.googleapis.com/v0/b/x/o/maps%2F1_poly.kmz?alt=media' },
      mapPoints: { stringValue: 'респ | 56.1, 60.1\nпарковка | 56.3, 60.3' },
    },
  });
  assert.equal(g.id, 'abc');
  assert.equal(g.title, 'Рубеж');
  assert.equal(g.points.length, 2);
  assert.deepEqual(g.center, { lat: 56.2, lng: 60.2 }); // average of points when no lat/lng
  assert.equal(formatFromName(g.mapUrl), 'kmz');
});

test('upcomingWithMap keeps future games with an uploaded map or points', () => {
  const base = { location: '', mapName: '', points: [], cancelled: false };
  const now = Date.parse('2030-01-01T00:00:00Z');
  const list = upcomingWithMap(
    [
      { ...base, id: 'past', title: '', start: '2029-12-01T00:00:00Z', center: { lat: 1, lng: 1 }, mapUrl: '' },
      { ...base, id: 'b', title: '', start: '2030-03-01T00:00:00Z', center: null, mapUrl: 'https://x/m.kml' },
      { ...base, id: 'a', title: '', start: '2030-02-01T00:00:00Z', center: { lat: 1, lng: 1 }, mapUrl: '', points: [{ kind: 'respawn', lat: 1, lng: 1, label: '' }] },
      { ...base, id: 'only-place', title: '', start: '2030-02-01T00:00:00Z', center: { lat: 1, lng: 1 }, mapUrl: '' },
      { ...base, id: 'nothing', title: '', start: '2030-02-01T00:00:00Z', center: null, mapUrl: '' },
      { ...base, id: 'off', title: '', start: '2030-02-01T00:00:00Z', center: { lat: 1, lng: 1 }, mapUrl: '', cancelled: true },
    ],
    now
  );
  assert.deepEqual(list.map((g) => g.id), ['a', 'b']);
});

test('formatFromName', () => {
  assert.equal(formatFromName('Полигон.KMZ'), 'kmz');
  assert.equal(formatFromName('https://h/o/maps%2F1_a.geojson?alt=media&token=t'), 'geojson');
  assert.equal(formatFromName('readme.txt'), null);
});
