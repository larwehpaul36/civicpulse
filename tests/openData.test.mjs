import test from 'node:test';
import assert from 'node:assert/strict';
import { OFFICE_COLUMNS, REPORT_COLUMNS, csvCell, officeRows, reportRows, toCsv } from '../lib/openData.js';
import { fetchAll } from '../lib/fetchAll.js';

test('cells are quoted when needed and spreadsheet formulas are neutralised', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(csvCell('=HYPERLINK("http://x")'), '"\'=HYPERLINK(""http://x"")"');
  for (const bad of ['+1', '-1', '@cmd', '=1+1']) assert.ok(csvCell(bad).startsWith("'"), bad);
  assert.equal(csvCell(-0.187), '-0.187', 'real numbers stay numbers');
  assert.equal(csvCell(null), ''); assert.equal(csvCell(undefined), ''); assert.equal(csvCell(NaN), '');
  assert.equal(csvCell(0), '0');
});

test('a file has a header, one line per row, Windows line ends, and a byte-order mark for Excel', () => {
  const text = toCsv(['a', 'b'], [{ a: 1, b: 'x,y' }, { a: 2 }]);
  assert.equal(text, '﻿a,b\r\n1,"x,y"\r\n2,\r\n');
});

const ISSUES = [{ id: 'i1', category_id: 'c1', region_id: 'r1', party_id: 'p1', severity: 'high', status: 'resolved', confirmation_count: 3, created_at: '2026-10-01T10:00:00Z', sent_at: '2026-10-02T10:00:00Z', resolved_at: '2026-10-12T10:00:00Z', days_open: 11, lat: 5.6, lng: -0.19, description: 'call me on 0240000000', reporter_id: 'SECRET' }];
const LOOKUPS = { categories: [{ id: 'c1', name: 'Pothole' }], regions: [{ id: 'r1', name: 'Accra' }], parties: [{ id: 'p1', name: '=Accra Assembly' }], fix: [{ issue_id: 'i1', reopen_count: 1 }] };

test('report rows use names, not ids, and carry only public columns', () => {
  const [r] = reportRows({ issues: ISSUES, ...LOOKUPS });
  assert.deepEqual(Object.keys(r), REPORT_COLUMNS);
  assert.equal(r.category, 'Pothole'); assert.equal(r.region, 'Accra'); assert.equal(r.times_reopened, 1);
  assert.ok(!JSON.stringify(r).includes('call me'), 'descriptions are never exported');
  assert.ok(!JSON.stringify(r).includes('SECRET'), 'nothing about the reporter is exported');
  const csv = toCsv(REPORT_COLUMNS, [r]);
  assert.ok(csv.includes("'=Accra Assembly"), 'office names cannot run as formulas');
});

test('before migration 019 (no reopen data) the files still build', () => {
  assert.equal(reportRows({ issues: ISSUES, ...LOOKUPS, fix: [] })[0].times_reopened, 0);
});

test('office rows match the tracker\'s numbers', () => {
  const [o] = officeRows({ issues: ISSUES, parties: LOOKUPS.parties, fix: LOOKUPS.fix }, Date.UTC(2026, 10, 7));
  assert.deepEqual(Object.keys(o), OFFICE_COLUMNS);
  assert.deepEqual([o.reports_sent, o.resolved, o.open_now, o.times_reopened, o.median_days_to_fix, o.resolved_percent], [1, 1, 0, 1, 10, 100]);
});

test('every page of a large table is read, not just the first 1000', async () => {
  const total = 2500;
  const calls = [];
  const rows = await fetchAll(async (a, b) => { calls.push([a, b]); return { data: Array.from({ length: Math.max(0, Math.min(b, total - 1) - a + 1) }, (_, k) => a + k), error: null }; });
  assert.equal(rows.length, total);
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('a failing page stops the export instead of producing a short file', async () => {
  await assert.rejects(fetchAll(async (a) => (a === 0 ? { data: Array(1000).fill(1), error: null } : { data: null, error: new Error('boom') })), /boom/);
});
