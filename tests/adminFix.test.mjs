import test from 'node:test';
import assert from 'node:assert/strict';
import { isDisputed, mergeFixChecks } from '../lib/adminFix.js';

test('answers are attached to the right reports, and reports without any get zeros', () => {
  const out = mergeFixChecks([{ id: 'a', status: 'resolved' }, { id: 'b', status: 'sent' }], [{ issue_id: 'a', reopen_count: 1, fixed: 1, partly: 2, not_fixed: 0 }]);
  assert.deepEqual(out.map((i) => [i.id, i.reopen_count, i.fix_fixed, i.fix_partly, i.fix_not]), [['a', 1, 1, 2, 0], ['b', 0, 0, 0, 0]]);
});

test('an older database (no 020, so no rows or an error object) leaves everything as it was', () => {
  for (const rows of [null, undefined, { message: 'function does not exist' }]) {
    const out = mergeFixChecks([{ id: 'a', status: 'resolved' }], rows);
    assert.equal(out[0].reopen_count, 0);
    assert.equal(isDisputed(out[0]), false);
  }
});

test('disputed means neighbours doubt it now, or it has been reopened before; agreement alone is not a dispute', () => {
  assert.equal(isDisputed({ status: 'resolved', fix_fixed: 3, fix_partly: 0, fix_not: 0, reopen_count: 0 }), false);
  assert.equal(isDisputed({ status: 'resolved', fix_fixed: 0, fix_partly: 1, fix_not: 0, reopen_count: 0 }), true);
  assert.equal(isDisputed({ status: 'sent', fix_fixed: 0, fix_partly: 0, fix_not: 0, reopen_count: 1 }), true);
  assert.equal(isDisputed({ status: 'rejected', fix_fixed: 0, fix_partly: 0, fix_not: 2, reopen_count: 2 }), false);
});
