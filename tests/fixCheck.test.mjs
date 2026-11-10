import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixCheck, sendFixCheck } from '../lib/fixCheck.js';
import { partyStats } from '../lib/trackerStats.js';

const ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const fake = ({ totals = { data: { reopen_count: 1, fixed: 2, partly: 1, not_fixed: 0 }, error: null }, mine = { data: { eligible: true, answer: 'fixed' }, error: null }, submit = { data: { answer: 'partly', reopened: false }, error: null } } = {}) => {
  const calls = [];
  return {
    calls,
    from: (t) => ({ select: (c) => ({ eq: (k, v) => ({ maybeSingle: async () => { calls.push(['from', t, c, k, v]); return totals; } }) }) }),
    rpc: async (n, a) => { calls.push(['rpc', n, a]); return n === 'my_fix_check' ? mine : submit; },
  };
};

test('the screen gets public totals and the visitor\'s own standing', async () => {
  const r = await loadFixCheck(fake(), ID);
  assert.deepEqual(r, { reopened: 1, fixed: 2, partly: 1, notFixed: 0, eligible: true, answer: 'fixed' });
});

test('an older database, a signed-out visitor or no network all mean "show nothing", not an error', async () => {
  const r = await loadFixCheck(fake({ totals: { data: null, error: { message: 'relation does not exist' } }, mine: { data: null, error: { message: 'permission denied' } } }), ID);
  assert.deepEqual(r, { reopened: 0, fixed: 0, partly: 0, notFixed: 0, eligible: false, answer: null });
});

test('only a visitor the database says is eligible is eligible', async () => {
  assert.equal((await loadFixCheck(fake({ mine: { data: { eligible: 'yes' }, error: null } }), ID)).eligible, false);
  assert.equal((await loadFixCheck(fake({ mine: { data: { eligible: false, answer: null }, error: null } }), ID)).eligible, false);
});

test('an answer is sent to the database, and a reopening is reported', async () => {
  const db = fake({ submit: { data: { answer: 'not_fixed', reopened: true }, error: null } });
  assert.deepEqual(await sendFixCheck(db, ID, 'not_fixed'), { answer: 'not_fixed', reopened: true });
  assert.deepEqual(db.calls, [['rpc', 'submit_fix_check', { p_issue: ID, p_answer: 'not_fixed' }]]);
});

test('nonsense answers never reach the network', async () => {
  const db = fake();
  assert.deepEqual(await sendFixCheck(db, ID, 'maybe'), { error: 'failed' });
  assert.equal(db.calls.length, 0);
});

test('database refusals become short codes', async () => {
  for (const [message, code] of [['not_involved', 'not_involved'], ['not_resolved', 'not_resolved'], ['boom', 'failed']]) {
    assert.deepEqual(await sendFixCheck(fake({ submit: { data: null, error: { message } } }), ID, 'fixed'), { error: code });
  }
});

test('the tracker counts how often an office\'s "fixes" were rejected by neighbours', () => {
  const NOW = Date.UTC(2026, 10, 5);
  const day = (n) => new Date(NOW - n * 86400000).toISOString();
  const rows = [
    { party_id: 'p1', sent_at: day(20), status: 'sent', resolved_at: null, reopen_count: 2 },
    { party_id: 'p1', sent_at: day(30), status: 'resolved', resolved_at: day(5), reopen_count: 1 },
    { party_id: 'p1', sent_at: day(9), status: 'sent', resolved_at: null },
    { party_id: 'p2', sent_at: day(9), status: 'sent', resolved_at: null, reopen_count: 5 },
    { party_id: 'p2', sent_at: null, status: 'reported', resolved_at: null, reopen_count: 7 },
  ];
  const by = Object.fromEntries(partyStats(rows, NOW).map((p) => [p.id, p]));
  assert.equal(by.p1.reopened, 3);
  assert.equal(by.p2.reopened, 5, 'a report never sent to the office is not counted against it');
  assert.equal(by.p1.open, 2, 'a reopened report is open again, so it also counts in the backlog');
});
