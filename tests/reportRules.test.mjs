import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { missingFor, REQUIRED } from '../lib/reportRules.js';

const empty = { categoryId: '', photo: null, loc: null, regionId: '', isOther: false, otherLabel: '' };
const photo = { name: 'x.jpg' };

test('step 1 needs a problem type and a photo, in the order they appear on screen', () => {
  assert.deepEqual(missingFor(0, empty), ['category', 'photo']);
  assert.deepEqual(missingFor(0, { ...empty, categoryId: 'c' }), ['photo']);
  assert.deepEqual(missingFor(0, { ...empty, photo }), ['category']);
  assert.deepEqual(missingFor(0, { ...empty, categoryId: 'c', photo }), []);
});

test('"Other" also needs the reporter\'s own words, and spaces do not count', () => {
  const base = { ...empty, categoryId: 'o', photo, isOther: true };
  assert.deepEqual(missingFor(0, base), ['other']);
  assert.deepEqual(missingFor(0, { ...base, otherLabel: '   ' }), ['other']);
  assert.deepEqual(missingFor(0, { ...base, otherLabel: 'fallen tree' }), []);
  assert.deepEqual(missingFor(0, { ...empty, categoryId: 'o', isOther: true }), ['other', 'photo']);
});

test('step 2 needs a region and the spot on the map', () => {
  assert.deepEqual(missingFor(1, empty), ['region', 'spot']);
  assert.deepEqual(missingFor(1, { ...empty, regionId: 'r' }), ['spot']);
  assert.deepEqual(missingFor(1, { ...empty, loc: { lat: 5, lng: 0 } }), ['region']);
  assert.deepEqual(missingFor(1, { ...empty, regionId: 'r', loc: { lat: 5, lng: 0 } }), []);
});

test('the last step has nothing required', () => {
  assert.deepEqual(missingFor(2, empty), []);
});

test('the form marks every required field with a star and an inline message', () => {
  const src = readFileSync(new URL('../components/ReportForm.js', import.meta.url), 'utf8');
  for (const key of [...REQUIRED[0], ...REQUIRED[1]]) {
    assert.ok(src.includes(`invalid('${key}'`), `${key} is never marked aria-invalid`);
    assert.ok(src.includes(`fix('${key}'`), `${key} has no message under it`);
  }
  assert.ok(src.includes('id={`err-${key}`}'), 'messages need ids so fields can point to them');
  assert.ok((src.match(/<Req \/>/g) || []).length >= 5, 'every required label needs the star');
  assert.ok(src.includes('reqnote'), 'the "* means required" note is missing');
});
