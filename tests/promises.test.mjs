import test from 'node:test';
import assert from 'node:assert/strict';
import { judgePromise, promiseStats, loadDateReplies, MIN_DECIDED } from '../lib/promises.js';

const TODAY = '2026-11-12';
const rep = (id, issue, date, at, party = 'P1') => ({ id, issue_id: issue, party_id: party, kind: 'expected_date', expected_date: date, created_at: at });
const issue = (id, status, resolved_at = null, party_id = 'P1') => ({ id, status, resolved_at, party_id });

test('kept: resolved on or before the promised date (same day counts)', () => {
  assert.equal(judgePromise(issue('a', 'resolved', '2026-11-10T23:59:00Z'), [rep(1, 'a', '2026-11-10', '2026-11-01T08:00:00Z')], TODAY).outcome, 'kept');
  assert.equal(judgePromise(issue('a', 'resolved', '2026-11-05T09:00:00Z'), [rep(1, 'a', '2026-11-10', '2026-11-01T08:00:00Z')], TODAY).outcome, 'kept');
});

test('late: resolved after the date', () => {
  assert.equal(judgePromise(issue('a', 'resolved', '2026-11-11T00:00:00Z'), [rep(1, 'a', '2026-11-10', '2026-11-01T08:00:00Z')], TODAY).outcome, 'late');
});

test('overdue vs pending for open reports; due today is still pending', () => {
  const r = (d) => [rep(1, 'a', d, '2026-11-01T08:00:00Z')];
  assert.equal(judgePromise(issue('a', 'sent'), r('2026-11-11'), TODAY).outcome, 'overdue');
  assert.equal(judgePromise(issue('a', 'in_progress'), r('2026-11-12'), TODAY).outcome, 'pending');
  assert.equal(judgePromise(issue('a', 'sent'), r('2026-11-20'), TODAY).outcome, 'pending');
});

test('only the FIRST date counts; moving it later cannot rescue a missed promise', () => {
  const replies = [rep(2, 'a', '2026-11-30', '2026-11-09T08:00:00Z'), rep(1, 'a', '2026-11-05', '2026-11-01T08:00:00Z'), rep(3, 'a', '2026-12-15', '2026-11-20T08:00:00Z')];
  const j = judgePromise(issue('a', 'resolved', '2026-11-25T10:00:00Z'), replies, TODAY);
  assert.equal(j.promised, '2026-11-05');
  assert.equal(j.outcome, 'late');
  assert.equal(j.moved, 2);
});

test('repeating the same date is not a move', () => {
  const j = judgePromise(issue('a', 'sent'), [rep(1, 'a', '2026-11-20', '2026-11-01T00:00:00Z'), rep(2, 'a', '2026-11-20', '2026-11-02T00:00:00Z')], TODAY);
  assert.equal(j.moved, 0);
});

test('no date, or a rejected report: nothing to judge', () => {
  assert.equal(judgePromise(issue('a', 'sent'), [], TODAY), null);
  assert.equal(judgePromise(issue('a', 'rejected'), [rep(1, 'a', '2026-11-01', '2026-10-01T00:00:00Z')], TODAY), null);
  assert.equal(judgePromise(issue('a', 'sent'), [{ id: 1, kind: 'reply', body: 'x', created_at: '2026-11-01T00:00:00Z' }], TODAY), null);
});

test('a reopened report (open again) is judged as open', () => {
  assert.equal(judgePromise(issue('a', 'sent', null), [rep(1, 'a', '2026-11-05', '2026-11-01T00:00:00Z')], TODAY).outcome, 'overdue');
});

test('the promise belongs to the office that made it, even if the report was reassigned', () => {
  const j = judgePromise(issue('a', 'sent', null, 'P2'), [rep(1, 'a', '2026-11-05', '2026-11-01T00:00:00Z', 'P1')], TODAY);
  assert.equal(j.partyId, 'P1');
});

test('promiseStats counts per office, sorts the most overdue first, and shows a percent only with enough decided promises', () => {
  const rows = [], replies = [];
  // P1: 5 kept, 1 late, 2 overdue, 1 pending
  const add = (id, status, resolved, party, date) => { rows.push(issue(id, status, resolved, party)); replies.push(rep(id, id, date, '2026-10-01T00:00:00Z', party)); };
  for (let n = 0; n < 5; n++) add(`k${n}`, 'resolved', '2026-10-20T00:00:00Z', 'P1', '2026-10-25');
  add('l1', 'resolved', '2026-10-30T00:00:00Z', 'P1', '2026-10-25');
  add('o1', 'sent', null, 'P1', '2026-11-01'); add('o2', 'sent', null, 'P1', '2026-11-02');
  add('p1', 'sent', null, 'P1', '2026-12-01');
  add('x1', 'resolved', '2026-10-20T00:00:00Z', 'P2', '2026-10-25');
  const [a, b] = promiseStats(rows, replies, TODAY);
  assert.equal(a.id, 'P1'); assert.equal(b.id, 'P2');
  assert.deepEqual([a.made, a.kept, a.late, a.overdue, a.pending, a.decided], [9, 5, 1, 2, 1, 8]);
  assert.equal(a.keptPercent, 63);        // 5 of 8 decided
  assert.equal(a.early, false);
  assert.equal(b.keptPercent, null); assert.equal(b.early, true);
  assert.equal(MIN_DECIDED, 5);
});

test('promiseStats ignores replies on issues it was not given, and issues with no office', () => {
  assert.deepEqual(promiseStats([issue('a', 'sent', null, null)], [{ ...rep(1, 'a', '2026-11-01', '2026-10-01T00:00:00Z'), party_id: null }], TODAY), []);
  assert.deepEqual(promiseStats([], [rep(1, 'zzz', '2026-11-01', '2026-10-01T00:00:00Z')], TODAY), []);
});

test('loadDateReplies pages through everything and quietly returns nothing when 021 is missing', async () => {
  const mk = (rows, error) => ({ from: () => ({ select: () => ({ eq: () => ({ order: () => ({ range: async (a, b) => ({ data: rows?.slice(a, b + 1), error }) }) }) }) }) });
  const many = Array.from({ length: 2300 }, (_, i) => ({ id: i }));
  assert.equal((await loadDateReplies(mk(many))).length, 2300);
  assert.deepEqual(await loadDateReplies(mk(null, { message: 'relation "office_replies" does not exist' })), []);
});
