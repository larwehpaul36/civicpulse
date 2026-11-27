import test from 'node:test';
import assert from 'node:assert/strict';
import { median, summarize, weeklyTrend, weeklyCounts, partyStats, sortParties, weekStart, firstReplies, replyDays } from '../lib/trackerStats.js';

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

// ---- replies ----
const withId = (id, r) => ({ ...r, id });
const at = (daysAgo) => ({ created_at: d(daysAgo) });

test('first reply per case is the earliest one; bad rows are ignored', () => {
  const m = firstReplies([{ issue_id: 'x', ...at(3) }, { issue_id: 'x', ...at(8) }, { issue_id: 'y', ...at(1) }, { issue_id: null, ...at(1) }, { issue_id: 'z', created_at: 'nonsense' }]);
  assert.equal(m.size, 2);
  assert.equal(m.get('x'), NOW - 8 * 86400000);
  assert.equal(firstReplies(null).size, 0);
});

test('reply days count from sent to first reply and never go negative', () => {
  assert.equal(replyDays({ sent_at: d(10) }, NOW - 6 * 86400000), 4);
  assert.equal(replyDays({ sent_at: d(2) }, NOW - 5 * 86400000), 0);
});

test('party reply stats: replied, median, waiting and longest wait', () => {
  const rows = [
    withId('1', open('a', 10)), withId('2', open('a', 20)), withId('3', open('a', 6)), withId('4', open('a', 30)),
    withId('5', fixed('a', 15, 5)), // fixed with no reply: neither replied nor waiting
  ];
  const first = firstReplies([{ issue_id: '1', ...at(8) }, { issue_id: '2', ...at(14) }]); // 1: after 2 days, 2: after 6 days
  const a = partyStats(rows, NOW, first).find((p) => p.id === 'a');
  assert.deepEqual([a.sent, a.replied, a.medianReply, a.waiting, a.oldestWaiting], [5, 2, 4, 2, 30]);
});

test('without reply data the reply fields are null, not zero', () => {
  const [a] = partyStats([withId('1', open('a', 5))], NOW);
  assert.deepEqual([a.replied, a.medianReply, a.waiting, a.oldestWaiting], [null, null, null, null]);
  const [b] = partyStats([withId('1', open('a', 5))], NOW, new Map());
  assert.deepEqual([b.replied, b.waiting], [0, 1], 'an empty reply table is real data: nobody replied');
});

test('sort by reply: fastest first, offices that never replied last, longest silence first', () => {
  const rows = [withId('1', open('quick', 9)), withId('2', open('slow', 20)), withId('3', open('mute', 5)), withId('4', open('mute2', 40))];
  const first = firstReplies([{ issue_id: '1', ...at(8) }, { issue_id: '2', ...at(2) }]);
  const ids = sortParties(partyStats(rows, NOW, first), 'reply').map((p) => p.id);
  assert.deepEqual(ids, ['quick', 'slow', 'mute2', 'mute']);
});

// ---- waitingList: the reports waiting longest for any word from their office ----
import { waitingList } from '../lib/trackerStats.js';
{
  const DAYMS = 86400000, now = Date.parse('2026-11-25T12:00:00Z');
  const ago = (d) => new Date(now - d * DAYMS).toISOString();
  const row = (id, o = {}) => ({ id, status: 'sent', party_id: 'p1', category_id: 'c1', sent_at: ago(10), resolved_at: null, ...o });
  const none = new Map();

  test('waitingList: longest wait first, and only reports with no reply, still open and with an office', () => {
    const rows = [row('a', { sent_at: ago(5) }), row('b', { sent_at: ago(40) }), row('c', { sent_at: ago(20) }),
      row('replied', { sent_at: ago(90) }), row('fixed', { status: 'resolved', sent_at: ago(80), resolved_at: ago(2) }),
      row('rejected', { status: 'rejected', sent_at: ago(70) }), row('unsent', { sent_at: null }), row('noparty', { party_id: null, sent_at: ago(60) })];
    const first = new Map([['replied', now - 3 * DAYMS]]);
    assert.deepEqual(waitingList(rows, first, now).map((x) => [x.id, x.days]), [['b', 40], ['c', 20], ['a', 5]]);
    assert.equal(waitingList(rows, none, now).length, 7 - 3 + 0, 'with an empty reply map, everything sent and open is waiting');
  });

  test('waitingList says nothing when replies cannot be read (migration 021 not run)', () => {
    assert.deepEqual(waitingList([row('a')], null, now), []);
    assert.deepEqual(waitingList(null, none, now), []);
  });

  test('waitingList: one office, a limit, and a steady order for equal waits', () => {
    const rows = [row('z', { sent_at: ago(9) }), row('y', { sent_at: ago(9) }), row('x', { sent_at: ago(9) }), row('o', { party_id: 'p2', sent_at: ago(50) })];
    assert.deepEqual(waitingList(rows, none, now, { partyId: 'p1' }).map((x) => x.id), ['x', 'y', 'z']);
    assert.deepEqual(waitingList(rows, none, now, { partyId: 'p1', limit: 2 }).map((x) => x.id), ['x', 'y']);
    assert.deepEqual(waitingList(rows, none, now, { partyId: 'p2' }).map((x) => x.id), ['o']);
    assert.deepEqual(waitingList(rows, none, now, { partyId: 'nobody' }), []);
    assert.equal(waitingList(rows, none, now, { limit: 100000 }).length, 4);
  });

  test('waitingList: a bad date never makes a wrong list, and a future send date is zero days', () => {
    assert.deepEqual(waitingList([row('a', { sent_at: 'garbage' })], none, now), []);
    assert.equal(waitingList([row('a', { sent_at: new Date(now + DAYMS).toISOString() })], none, now)[0].days, 0);
  });

  test('the tracker page shows the list only when replies could be read, and keeps its honest note', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync(new URL('../app/tracker/page.js', import.meta.url), 'utf8');
    assert.ok(/\{first && \(\s*<section className="card" aria-labelledby="waiting-longest">/.test(page));
    assert.ok(/list=\{first \? listFor\(p\.id\) : null\}/.test(page));
    const { strings } = await import('../lib/strings.js');
    assert.ok(strings.tracker2.waitNote.includes('still show here'));
    assert.ok(!strings.tracker2.how.join(' ').includes('do not sign in'), 'the old "offices do not sign in" line is gone');
    assert.equal(strings.tracker2.waitingDays(1), 'Waiting 1 day');
    assert.equal(strings.tracker2.waitingDays(12), 'Waiting 12 days');
  });
}
