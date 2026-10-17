// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDirectory, matchesSearch, changedFields, areaLabel } from '../lib/directory.js';

const parties = [
  { id: 'p2', name: 'Zoomlion', type: 'private', region_id: 'r1', verified: true },
  { id: 'p1', name: 'Accra Assembly', type: 'government', region_id: 'r1', verified: true },
  { id: 'p3', name: 'Unverified Fake', type: 'government', region_id: 'r1', verified: false },
];
const responsibilities = [
  { party_id: 'p1', category_id: 'gutter', region_id: 'r1' },
  { party_id: 'p1', category_id: 'light', region_id: 'r1' },
  { party_id: 'p1', category_id: 'gutter', region_id: 'r2' },
  { party_id: 'p3', category_id: 'gutter', region_id: 'r1' },
];

test('directory lists verified parties only, sorted by name, with coverage grouped by area', () => {
  const dir = buildDirectory(parties, responsibilities);
  assert.deepEqual(dir.map((e) => e.name), ['Accra Assembly', 'Zoomlion']);
  assert.deepEqual(dir[0].coverage, [
    { region_id: 'r1', category_ids: ['gutter', 'light'] },
    { region_id: 'r2', category_ids: ['gutter'] },
  ]);
  assert.deepEqual(dir[1].coverage, []);
});

test('search needs every word, in any of: name, home area, covered areas, problem names', () => {
  const [accra] = buildDirectory(parties, responsibilities);
  const names = { catName: { gutter: 'Choked gutter', light: 'Streetlight' }, areaName: (id) => ({ r1: 'Greater Accra', r2: 'Osu, Greater Accra' }[id] ?? '') };
  const hit = (q) => matchesSearch(accra, q, names);
  assert.equal(hit(''), true);
  assert.equal(hit('  '), true);
  assert.equal(hit('gutter'), true);
  assert.equal(hit('STREETLIGHT osu'), true);
  assert.equal(hit('assembly greater'), true);
  assert.equal(hit('pothole'), false);
  assert.equal(hit('gutter kumasi'), false);
});

test('a correction shows only what was filled in and differs from now', () => {
  const current = { name: 'Accra Assembly', email: 'old@x.gov', phone: '0301', whatsapp: null };
  const suggestion = { name: 'Accra Assembly', email: 'new@x.gov', phone: null, whatsapp: '233301' };
  assert.deepEqual(changedFields(suggestion, current), [
    { field: 'email', from: 'old@x.gov', to: 'new@x.gov' },
    { field: 'whatsapp', from: '', to: '233301' },
  ]);
  assert.deepEqual(changedFields({ name: 'X' }, null), [{ field: 'name', from: '', to: 'X' }]);
  assert.deepEqual(changedFields({}, current), []);
});

test('area label puts a city before its region', () => {
  const byId = { r1: { id: 'r1', name: 'Greater Accra', level: 'region', parent_id: null }, r2: { id: 'r2', name: 'Osu', level: 'city', parent_id: 'r1' } };
  assert.equal(areaLabel('r2', byId), 'Osu, Greater Accra');
  assert.equal(areaLabel('r1', byId), 'Greater Accra');
  assert.equal(areaLabel('nope', byId), '');
  assert.equal(areaLabel(null, byId), '');
});
