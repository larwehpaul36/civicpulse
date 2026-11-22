import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { missingFor, REQUIRED, DUPLICATE_RADIUS_M, duplicateText, duplicateKey, duplicateCheckDue } from '../lib/reportRules.js';

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

test('duplicate check: wide enough for phone GPS, and the form really uses the shared radius', () => {
  assert.ok(DUPLICATE_RADIUS_M >= 100 && DUPLICATE_RADIUS_M <= 150);
  const src = readFileSync(new URL('../components/ReportForm.js', import.meta.url), 'utf8');
  assert.ok(src.includes('radius_m: DUPLICATE_RADIUS_M'), 'the form must not hard-code its own radius');
});

test('a match with no description tells people what to do instead of showing a dash', () => {
  assert.equal(duplicateText({ description: '  Big hole  ' }, 'x'), 'Big hole');
  for (const d of [{ description: null }, { description: '   ' }, {}, null]) assert.equal(duplicateText(d, 'fallback'), 'fallback');
});

test('the similar-report check is due once per category and spot, never for "Other", never offline', () => {
  const loc = { lat: 5.60371, lng: -0.18701 };
  const key = duplicateKey('c1', loc);
  assert.equal(key, 'c1|5.60371|-0.18701');
  assert.equal(duplicateKey('', loc), ''); assert.equal(duplicateKey('c1', null), ''); assert.equal(duplicateKey('c1', { lat: NaN, lng: 1 }), '');
  assert.equal(duplicateCheckDue({ isOther: false, online: true, checkedKey: '', key }), true);
  assert.equal(duplicateCheckDue({ isOther: false, online: true, checkedKey: key, key }), false, 'already checked for this category and spot');
  assert.equal(duplicateCheckDue({ isOther: false, online: true, checkedKey: key, key: duplicateKey('c2', loc) }), true, 'a different category is checked again');
  assert.equal(duplicateCheckDue({ isOther: false, online: true, checkedKey: key, key: duplicateKey('c1', { lat: 5.6041, lng: -0.1870 }) }), true, 'a moved spot is checked again');
  assert.equal(duplicateCheckDue({ isOther: true, online: true, checkedKey: '', key }), false);
  assert.equal(duplicateCheckDue({ isOther: false, online: false, checkedKey: '', key }), false);
  assert.equal(duplicateCheckDue({ isOther: false, online: true, checkedKey: '', key: '' }), false, 'no spot yet');
});

test('the form runs the check on the place step, and its "different problem" button continues instead of sending from there', () => {
  const src = readFileSync(new URL('../components/ReportForm.js', import.meta.url), 'utf8');
  assert.match(src, /if \(step === 1 && duplicateCheckDue\(/);
  assert.match(src, /if \(step === 2\) submit\(true\); else setStep\(2\);/);
  assert.match(src, /duplicateCheckDue\(\{ isOther, online: navigator\.onLine, checkedKey, key: dupKey \}\)\) \{\s*setStatus\('checking'\);\s*stage = 'duplicates'/);
});
