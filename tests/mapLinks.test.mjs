import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coords, coordsText, googleMapsUrl, osmUrl } from '../lib/mapLinks.js';
import { strings } from '../lib/strings.js';

const grab = (url) => (url.match(/-?\d+\.\d+/g) || []).map(Number);

test('both links carry identical coordinates', () => {
  for (const [lat, lng] of [[5.6037, -0.187], ['5.6037', '-0.187'], [6.6885, -1.6244], [-33.9, 151.2], [90, 180], [-90, -180]]) {
    const g = grab(googleMapsUrl(lat, lng)), o = grab(osmUrl(lat, lng));
    assert.equal(g[0], Number(lat));
    assert.equal(g[1], Number(lng));
    assert.deepEqual(o.slice(0, 2), g);
  }
});

test('the Google link uses the documented format', () => {
  assert.equal(googleMapsUrl(5.6037, -0.187), 'https://www.google.com/maps/search/?api=1&query=5.603700%2C-0.187000');
  assert.equal(osmUrl(5.6037, -0.187), 'https://www.openstreetmap.org/?mlat=5.603700&mlon=-0.187000#map=18/5.603700/-0.187000');
  assert.equal(coordsText(5.6037, -0.187), '5.603700, -0.187000');
});

test('missing, broken or impossible locations give no link', () => {
  for (const [a, b] of [[null, null], [undefined, 1], ['', ''], ['x', 'y'], [NaN, 1], [0, 0], ['0', '0'], [91, 0], [0, 181], [Infinity, 1]]) {
    assert.equal(coords(a, b), null);
    assert.equal(googleMapsUrl(a, b), null);
    assert.equal(osmUrl(a, b), null);
    assert.equal(coordsText(a, b), null);
  }
  assert.ok(googleMapsUrl(0, 36.8)); // the equator alone is fine
});

test('the office message leaves the Location line out when there is no link', () => {
  const base = { party: 'A', category: 'Pothole', severity: 'High', days: 1, confirmations: 1, reportUrl: 'r' };
  const without = strings.admin.escalationMessage({ ...base, mapUrl: null });
  const missing = strings.admin.escalationMessage(base);
  const withLoc = strings.admin.escalationMessage({ ...base, mapUrl: googleMapsUrl(5.6037, -0.187) });
  for (const m of [without, missing]) assert.ok(!/Location:|null|undefined/.test(m));
  assert.ok(withLoc.includes('Location: https://www.google.com/maps/search/?api=1&query=5.603700%2C-0.187000'));
});

test('the admin screen uses the helper, opens links safely and no longer builds null links', () => {
  const src = readFileSync(new URL('../components/AdminIssue.js', import.meta.url), 'utf8');
  assert.ok(!/mlat=\$\{/.test(src), 'no hand-built map URL left');
  assert.ok(/googleMapsUrl\(i\.lat, i\.lng\)/.test(src) && /osmUrl\(i\.lat, i\.lng\)/.test(src));
  assert.equal((src.match(/rel="noopener noreferrer"/g) || []).length >= 2, true);
});
