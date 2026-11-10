import test from 'node:test';
import assert from 'node:assert/strict';
import { lastFullMonth, monthlyReport, monthRange, shiftMonth } from '../lib/monthly.js';

const D = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 12)).toISOString(); // m is 1-12 here
const row = (party, sent, resolved, extra = {}) => ({ party_id: party, status: resolved ? 'resolved' : 'sent', created_at: sent, sent_at: sent, resolved_at: resolved ?? null, ...extra });
const OCT = { year: 2026, month: 9 }; // month is 0-11 in the report

test('month arithmetic, including the year boundary', () => {
  assert.deepEqual(lastFullMonth(Date.UTC(2026, 10, 7)), { year: 2026, month: 9 });
  assert.deepEqual(lastFullMonth(Date.UTC(2027, 0, 3)), { year: 2026, month: 11 });
  assert.deepEqual(shiftMonth({ year: 2026, month: 0 }, -1), { year: 2025, month: 11 });
  assert.deepEqual(shiftMonth({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 });
  assert.equal(monthRange(2026, 9).end - monthRange(2026, 9).start, 31 * 86400000);
});

test('the headline counts what happened inside the month only', () => {
  const rows = [
    row('a', D(2026, 10, 2), D(2026, 10, 12)),          // sent and fixed in October: 10 days
    row('a', D(2026, 9, 20), D(2026, 10, 10)),          // sent in September, fixed in October: 20 days
    row('a', D(2026, 10, 20), D(2026, 11, 3)),          // fixed in November: not October
    row('b', D(2026, 10, 5), null),
    { party_id: null, status: 'reported', created_at: D(2026, 10, 9), sent_at: null, resolved_at: null },
    { party_id: 'a', status: 'reported', created_at: D(2026, 8, 1), sent_at: null, resolved_at: null },
  ];
  const { headline } = monthlyReport(rows, OCT);
  assert.deepEqual(headline, { filed: 4, sent: 3, resolved: 2, medianDays: 15 });
});

test('slowest: offices whose oldest case had waited longest at month end, counting cases fixed later as still open then', () => {
  const rows = [
    row('slow', D(2026, 7, 1), null),                    // waiting since July
    row('slow', D(2026, 10, 1), null),
    row('late', D(2026, 8, 1), D(2026, 11, 10)),         // fixed in November, so still open on 31 Oct
    row('fast', D(2026, 10, 3), D(2026, 10, 5)),         // fixed: not open
    row('future', D(2026, 11, 2), null),                 // sent after the month ended: ignored
  ];
  const { slowest } = monthlyReport(rows, OCT);
  assert.deepEqual(slowest.map((o) => o.id), ['slow', 'late']);
  assert.equal(slowest[0].openAtEnd, 2);
  assert.ok(slowest[0].oldestOpenAtEnd >= 122);
});

test('most improved needs enough fixes in both periods and a real improvement', () => {
  const rows = [];
  for (const d of [3, 6, 9]) rows.push(row('better', D(2026, 7, d), D(2026, 7, d + 20)));        // before: 20 days each (Jul)
  for (const d of [3, 6, 9]) rows.push(row('better', D(2026, 10, d), D(2026, 10, d + 5)));       // now: 5 days each
  for (const d of [3, 6, 9]) rows.push(row('worse', D(2026, 8, d), D(2026, 8, d + 5)));
  for (const d of [3, 6, 9]) rows.push(row('worse', D(2026, 10, d), D(2026, 10, d + 15)));
  for (const d of [3, 6]) rows.push(row('few', D(2026, 7, d), D(2026, 7, d + 20)), row('few', D(2026, 10, d), D(2026, 10, d + 1))); // only 2 each
  const { improved } = monthlyReport(rows, OCT);
  assert.deepEqual(improved.map((o) => [o.id, o.fasterBy]), [['better', 15]]);
});

test('a reopened report counts against the office, and a report that is open again is not "fixed"', () => {
  const rows = [
    row('a', D(2026, 10, 1), D(2026, 10, 4), { reopen_count: 0 }),
    { ...row('a', D(2026, 10, 2), null), status: 'sent', reopen_count: 2 },   // resolved, disputed, reopened twice: no resolved date now
  ];
  const r = monthlyReport(rows, OCT);
  assert.equal(r.headline.resolved, 1);
  assert.equal(r.slowest[0].reopened, 2);
  assert.equal(r.slowest[0].openAtEnd, 1);
});

test('an empty month is fine', () => {
  const r = monthlyReport([], OCT);
  assert.deepEqual(r.headline, { filed: 0, sent: 0, resolved: 0, medianDays: null });
  assert.deepEqual([r.slowest, r.improved, r.mostFixes], [[], [], []]);
});
