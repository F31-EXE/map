import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHUNK, encodeMarks, isMarksCode, MarksCollector, type SharedMark } from '../src/lib/markShare.ts';

test('marks survive several QR codes in any order', () => {
  const marks: SharedMark[] = [];
  for (let i = 0; i < 40; i++) {
    marks.push({ kind: 'enemy', label: `Пулемёт ${i}`, lat: 56.8 + i / 1000, lng: 60.6 + i / 1000 });
  }
  marks.push({
    kind: 'arrow',
    label: 'Маршрут',
    lat: 56.81,
    lng: 60.61,
    points: [{ lat: 56.800001, lng: 60.600001 }, { lat: 56.81, lng: 60.61 }],
    color: '#FF4D4D',
  });
  marks.push({ kind: 'friendly', label: '', lat: 1, lng: 2, color: '#3D9BFF' });
  const codes = encodeMarks(marks, 'ab12');
  assert.ok(codes.length > 1);
  assert.ok(codes.every((c) => isMarksCode(c) && c.length <= CHUNK + 30));

  const c = new MarksCollector();
  assert.equal(c.push('grimmap://join?team=x'), null);
  const order = [...codes].reverse();
  let last = null;
  for (const code of [order[0], order[0], ...order.slice(1)]) last = c.push(code);
  assert.ok(last?.marks);
  assert.equal(last.marks.length, 42);
  assert.equal(last.marks[0].label, 'Пулемёт 0');
  const route = last.marks[40];
  assert.deepEqual(route.points, [{ lat: 56.8, lng: 60.6 }, { lat: 56.81, lng: 60.61 }]);
  assert.equal(route.color, '#FF4D4D');
  assert.equal(last.marks[41].color, '#3D9BFF');
  assert.equal(last.marks[41].points, undefined);
});

test('a new set starts over', () => {
  const c = new MarksCollector();
  const a = encodeMarks([{ kind: 'enemy', label: 'x'.repeat(60), lat: 1, lng: 1 }], 'a');
  const b = encodeMarks([{ kind: 'friendly', label: 'y', lat: 2, lng: 2 }], 'b');
  assert.equal(c.push(a[0])?.marks?.[0].kind, 'enemy');
  assert.equal(c.push(b[0])?.marks?.[0].kind, 'friendly');
});

test('codes are plain ASCII, Cyrillic comes back intact', () => {
  const codes = encodeMarks([{ kind: 'enemy', label: 'Пулемёт «Ёж»', lat: 1, lng: 1 }]);
  assert.ok(codes.every((c) => /^[\x20-\x7e]*$/.test(c)));
  assert.equal(new MarksCollector().push(codes[0])?.marks?.[0].label, 'Пулемёт «Ёж»');
  assert.deepEqual(encodeMarks([{ kind: 'enemy', label: 'a', lat: 1, lng: 1 }]), encodeMarks([{ kind: 'enemy', label: 'a', lat: 1, lng: 1 }]));
});
