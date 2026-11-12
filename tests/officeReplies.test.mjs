import test from 'node:test';
import assert from 'node:assert/strict';
import { loadReplies, latestExpectedDate, isOverdue, checkReply, errorKey, addReply, hideReply, loadAdminReplies } from '../lib/officeReplies.js';

const TODAY = '2026-11-12';
const fakeSupabase = ({ rows, error, rpcError } = {}) => {
  const calls = [];
  return {
    calls,
    from: (t) => ({ select: () => ({ eq: () => ({ order: async () => ({ data: rows ?? null, error: error ?? null }) }) }) }),
    rpc: async (name, args) => { calls.push([name, args]); return { data: rows ?? null, error: rpcError ?? null }; },
  };
};

test('loadReplies returns rows, and quietly returns nothing on any failure', async () => {
  assert.equal((await loadReplies(fakeSupabase({ rows: [{ id: 1 }] }), 'x')).length, 1);
  assert.deepEqual(await loadReplies(fakeSupabase({ error: { message: 'relation does not exist' } }), 'x'), []);
  assert.deepEqual(await loadReplies(fakeSupabase({ rows: null }), 'x'), []);
});

test('latestExpectedDate takes the newest date and ignores other kinds', () => {
  const r = [{ kind: 'expected_date', expected_date: '2026-11-20' }, { kind: 'reply', body: 'hi' }, { kind: 'expected_date', expected_date: '2026-12-01' }];
  assert.equal(latestExpectedDate(r), '2026-12-01');
  assert.equal(latestExpectedDate([{ kind: 'reply', body: 'x' }]), null);
});

test('isOverdue only for open reports past their date', () => {
  assert.equal(isOverdue('2026-11-10', 'sent', TODAY), true);
  assert.equal(isOverdue('2026-11-12', 'sent', TODAY), false); // due today is not late
  assert.equal(isOverdue('2026-11-10', 'resolved', TODAY), false);
  assert.equal(isOverdue('2026-11-10', 'rejected', TODAY), false);
  assert.equal(isOverdue(null, 'sent', TODAY), false);
});

test('checkReply mirrors the database rules', () => {
  assert.equal(checkReply({ kind: 'reply', body: ' ok ' }, TODAY), null);
  assert.equal(checkReply({ kind: 'reply', body: '   ' }, TODAY), 'text_required');
  assert.equal(checkReply({ kind: 'not_ours', body: '' }, TODAY), 'text_required');
  assert.equal(checkReply({ kind: 'reply', body: 'x'.repeat(501) }, TODAY), 'too_long');
  assert.equal(checkReply({ kind: 'reply', body: 'x'.repeat(500) }, TODAY), null);
  assert.equal(checkReply({ kind: 'expected_date', expected: '' }, TODAY), 'date_required');
  assert.equal(checkReply({ kind: 'expected_date', expected: '2026-11-11' }, TODAY), 'bad_date');
  assert.equal(checkReply({ kind: 'expected_date', expected: TODAY }, TODAY), null);
  assert.equal(checkReply({ kind: 'expected_date', expected: '2027-11-12' }, TODAY), null);  // exactly 365 days
  assert.equal(checkReply({ kind: 'expected_date', expected: '2027-11-13' }, TODAY), 'bad_date');
  assert.equal(checkReply({ kind: 'shout', body: 'x' }, TODAY), 'bad_kind');
});

test('errorKey recognises database errors and falls back to failed', () => {
  assert.equal(errorKey({ message: 'no_party' }), 'no_party');
  assert.equal(errorKey({ details: 'bad_date' }), 'bad_date');
  assert.equal(errorKey({ message: 'network down' }), 'failed');
  assert.equal(errorKey(null), 'failed');
});

test('addReply validates first, sends trimmed text, and only sends a date for expected_date', async () => {
  const sb = fakeSupabase();
  assert.deepEqual(await addReply(sb, 'i1', { kind: 'reply', body: '  ' }, TODAY), { error: 'text_required' });
  assert.equal(sb.calls.length, 0, 'nothing sent when invalid');
  assert.deepEqual(await addReply(sb, 'i1', { kind: 'reply', body: ' See you Friday ', expected: '2026-12-01' }, TODAY), { ok: true });
  assert.deepEqual(sb.calls[0], ['admin_add_office_reply', { p_issue: 'i1', p_kind: 'reply', p_body: 'See you Friday', p_expected: null }]);
  await addReply(sb, 'i1', { kind: 'expected_date', body: '', expected: '2026-12-01' }, TODAY);
  assert.deepEqual(sb.calls[1][1], { p_issue: 'i1', p_kind: 'expected_date', p_body: null, p_expected: '2026-12-01' });
  assert.deepEqual(await addReply(fakeSupabase({ rpcError: { message: 'no_party' } }), 'i1', { kind: 'reply', body: 'x' }, TODAY), { error: 'no_party' });
});

test('hideReply and loadAdminReplies call the right functions', async () => {
  const sb = fakeSupabase({ rows: [{ id: 'r1' }] });
  assert.deepEqual(await hideReply(sb, 'r1'), { ok: true });
  assert.deepEqual(sb.calls[0], ['admin_hide_office_reply', { p_reply: 'r1' }]);
  assert.equal((await loadAdminReplies(sb, 'i1')).length, 1);
  assert.deepEqual(await hideReply(fakeSupabase({ rpcError: { message: 'not_moderator' } }), 'r1'), { error: 'not_moderator' });
  assert.deepEqual(await loadAdminReplies(fakeSupabase({ rpcError: { message: 'x' } }), 'i1'), []);
});
