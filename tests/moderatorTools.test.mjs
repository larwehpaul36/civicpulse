import test from 'node:test';
import assert from 'node:assert/strict';
import { BULK_MAX, toggleId, selectShown, keepVisible, summarize, failureKey, failureCounts, bulkErrorKey, groupActivity, describeActivity } from '../lib/moderatorTools.js';
import { strings } from '../lib/strings.js';

const T = strings.admin.activity;

test('toggle adds and removes', () => {
  let r = toggleId([], 'a'); assert.deepEqual(r, { ids: ['a'], full: false });
  r = toggleId(['a', 'b'], 'a'); assert.deepEqual(r.ids, ['b']);
});
test('toggle refuses past the limit but still allows removing', () => {
  const full = Array.from({ length: BULK_MAX }, (_, i) => `i${i}`);
  const r = toggleId(full, 'new'); assert.equal(r.full, true); assert.equal(r.ids.length, BULK_MAX);
  assert.equal(toggleId(full, 'i0').ids.length, BULK_MAX - 1);
});
test('select all takes the first 50 and says how many were left out', () => {
  const shown = Array.from({ length: 60 }, (_, i) => ({ id: `i${i}` }));
  const r = selectShown(shown); assert.equal(r.ids.length, 50); assert.equal(r.cut, 10);
  assert.deepEqual(selectShown([{ id: 'x' }]), { ids: ['x'], cut: 0 });
});
test('keepVisible drops ids that left the list', () => {
  assert.deepEqual(keepVisible(['a', 'b', 'c'], [{ id: 'b' }, { id: 'c' }]), ['b', 'c']);
});
test('summarize counts done and failed', () => {
  const r = summarize([{ issue_id: '1', ok: true }, { issue_id: '2', ok: false, error: 'party_required' }]);
  assert.equal(r.total, 2); assert.equal(r.done, 1); assert.deepEqual(r.failed, [{ id: '2', error: 'party_required' }]);
  assert.deepEqual(summarize(null), { total: 0, done: 0, failed: [] });
});
test('failure reasons are grouped', () => {
  assert.equal(failureKey('after_photo_required'), 'after_photo_required');
  assert.equal(failureKey('weird'), 'other');
  assert.deepEqual(failureCounts([{ error: 'party_required' }, { error: 'party_required' }, { error: 'x' }]), { party_required: 2, other: 1 });
});
test('every failure key has a sentence', () => {
  for (const k of ['party_required', 'after_photo_required', 'not_found', 'other']) assert.equal(typeof strings.admin.bulk.why[k](2), 'string');
});
test('call errors map to messages that exist', () => {
  for (const e of ['nothing_selected', 'too_many', 'party_not_found', 'not_moderator', 'boom']) assert.ok(strings.admin.bulk.errors[bulkErrorKey({ message: e })]);
});
test('bulk batches collapse into one line, single actions stay separate', () => {
  const rows = [
    { id: 5, action: 'status', moderator_id: 'm1', detail: { to: 'rejected', batch: 'B' } },
    { id: 4, action: 'status', moderator_id: 'm1', detail: { to: 'rejected', batch: 'B' } },
    { id: 3, action: 'status', moderator_id: 'm1', detail: { to: 'verified' } },
    { id: 2, action: 'status', moderator_id: 'm1', detail: { to: 'verified' } },
    { id: 1, action: 'status', moderator_id: 'm2', detail: { to: 'rejected', batch: 'B' } },
  ];
  const g = groupActivity(rows);
  assert.equal(g.length, 4); assert.equal(g[0].count, 2); assert.equal(g[1].count, 1); assert.equal(g[3].count, 1);
});
test('sentences read well', () => {
  assert.equal(describeActivity({ action: 'status', count: 1, detail: { to: 'rejected' } }, T), 'Marked a report as rejected');
  assert.equal(describeActivity({ action: 'status', count: 12, detail: { to: 'sent' } }, T), 'Marked 12 reports as sent to the office');
  assert.equal(describeActivity({ action: 'assign_office', count: 3, detail: { to: 'p' } }, T, { parties: { p: 'Ga East' } }), 'Assigned 3 reports to Ga East');
  assert.equal(describeActivity({ action: 'assign_office', count: 1, detail: { to: 'zz' } }, T, { parties: {} }), 'Assigned a report to an office');
  assert.equal(describeActivity({ action: 'revoke_staff', detail: { email: 'a@b.gh', party: 'p' } }, T, { parties: { p: 'Ga East' } }), 'Removed a@b.gh from Ga East');
  assert.match(describeActivity({ action: 'mystery', detail: {} }, T), /mystery/);
});
