import test from 'node:test';
import assert from 'node:assert/strict';
import { median, summarize, weeklyTrend, weeklyCounts, partyStats, sortParties, weekStart } from '../lib/trackerStats.js';

const NOW = Date.UTC(2026, 9, 21, 12); // Wednesday 21 Oct 2026
const d = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString();
const row = (o) => ({ status: 'reported', party_id: null, created_at: d(30), sent_at: null, resolved_at: null, ...o });
const fixed = (party, sentAgo, days) => row({ party_id: party, status: 'resolved', sent_at: d(sentAgo), resolved_at: d(sentAgo - days) });
const open = (party, sentAgo) => row({ party_id: party, status: 'sent', sent_at: d(sentAgo) });

test('median is the middle case and ignores one slow outlier', () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([1, 2, 90]), 2);
  assert.equal(median([2, 4]), 3);
});

test('summarize counts sent, fixed and open correctly', () => {
  const rows = [row({}), open('a', 5), fixed('a', 10, 4), fixed('a', 12, 2)];
  assert.deepEqual(summarize(rows), { filed: 4, sent: 3, resolved: 2, open: 1, median: 3 });
});

test('party stats count only cases sent to the party, with backlog, oldest case and early-data flag', () => {
  const rows = [row({ party_id: 'a' }), fixed('a', 10, 4), fixed('a', 9, 2), open('a', 7), open('b', 20), open('b', 3)];
  const [a, b] = ['a', 'b'].map((id) => partyStats(rows, NOW).find((p) => p.id === id));
  assert.deepEqual([a.sent, a.resolved, a.open, a.median, a.rate, a.early, a.oldestOpen], [3, 2, 1, 3, 67, false, 7]);
  assert.deepEqual([b.sent, b.resolved, b.open, b.median, b.rate, b.early, b.oldestOpen], [2, 0, 2, null, 0, true, 20]);
});

test('sorting: fastest puts offices with fixes first and never hides offices with none', () => {
  const rows = [fixed('slow', 30, 20), fixed('fast', 30, 1), open('none', 40), open('none', 2)];
  const ids = (m) => sortParties(partyStats(rows, NOW), m).map((p) => p.id);
  assert.deepEqual(ids('fastest'), ['fast', 'slow', 'none']);
  assert.equal(ids('backlog')[0], 'none');
  assert.equal(ids('oldest')[0], 'none');
});

test('weekly trend buckets by Monday, oldest week first, and ignores the future and old dates', () => {
  assert.equal(new Date(weekStart(NOW)).getUTCDay(), 1);
  const rows = [row({ created_at: d(0) }), row({ created_at: d(1) }), row({ created_at: d(8) }), row({ created_at: d(200) }), row({ created_at: new Date(NOW + 86400000).toISOString() })];
  const t = weeklyTrend(rows, NOW, 12);
  assert.equal(t.length, 12);
  assert.equal(t[11].filed, 2); // this week (Mon 19 to Wed 21)
  assert.equal(t[10].filed, 1); // last week
  assert.equal(t.reduce((n, w) => n + w.filed, 0), 3);
  assert.ok(t[0].start < t[11].start);
  assert.deepEqual(weeklyCounts([d(0)], NOW, 8).slice(-1), [1]);
});
