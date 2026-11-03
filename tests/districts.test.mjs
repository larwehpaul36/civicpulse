import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MMDAS, SOURCE_COUNTS, OFFICIAL_TOTAL, OFFICIAL_METROPOLITAN } from '../data/mmdas.mjs';
import { districtsSql } from '../scripts/gen-districts-sql.mjs';

test('the list has all 261 assemblies, 6 of them metropolitan', () => {
  assert.equal(MMDAS.length, OFFICIAL_TOTAL);
  assert.equal(MMDAS.filter((d) => d.category === 'M').length, OFFICIAL_METROPOLITAN);
});

test('each region has the number of assemblies its source list gives', () => {
  const counts = {};
  for (const d of MMDAS) counts[d.region] = (counts[d.region] ?? 0) + 1;
  assert.deepEqual(counts, SOURCE_COUNTS);
  assert.equal(Object.values(SOURCE_COUNTS).reduce((a, b) => a + b, 0), OFFICIAL_TOTAL);
});

test('names are clean and unique inside each region', () => {
  const seen = new Set();
  for (const d of MMDAS) {
    assert.match(d.name, /^[A-Za-z][A-Za-z\-\/ ]+ (Metropolitan|Municipal|District)$/, d.name);
    assert.ok(!/(Metropolitan|Municipal|District) (Metropolitan|Municipal|District)/.test(d.name), `doubled word: ${d.name}`);
    const key = `${d.region}|${d.name}`;
    assert.ok(!seen.has(key), `duplicate: ${key}`);
    seen.add(key);
  }
});

test('every region in the list is one the database already has (from 002)', () => {
  const seed = readFileSync(new URL('../002_ghana_regions.sql', import.meta.url), 'utf8');
  for (const region of Object.keys(SOURCE_COUNTS)) assert.ok(seed.includes(`('${region}')`), `002 has no region ${region}`);
});

test('the SQL file is exactly what the generator produces (no drift, no hand edits)', () => {
  const file = readFileSync(new URL('../012_districts.sql', import.meta.url), 'utf8');
  assert.equal(file, districtsSql());
  assert.equal((file.match(/^    \('/gm) ?? []).length, OFFICIAL_TOTAL);
});
