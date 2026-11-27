import test from 'node:test';
import assert from 'node:assert/strict';
import { abuseKey, mergeSpam, isSuspicious } from '../lib/spamSignals.js';
import { strings } from '../lib/strings.js';

test('limit errors are recognised by code or by message', () => {
  assert.equal(abuseKey({ code: 'CP001' }), 'rate');
  assert.equal(abuseKey({ message: 'report_rate_limited' }), 'rate');
  assert.equal(abuseKey({ code: 'CP002' }), 'outside');
  assert.equal(abuseKey({ message: 'outside_ghana' }), 'outside');
  assert.equal(abuseKey({ code: 'CP003' }), 'flagRate');
  assert.equal(abuseKey({ message: 'network error' }), null);
  assert.equal(abuseKey(null), null);
});
test('every limit has a message for the person', () => {
  for (const k of ['rate', 'outside', 'flagRate']) assert.ok(strings.spam.errors[k].length > 10);
});
test('every reason the database can give has a sentence', () => {
  for (const k of ['flagged', 'burst', 'same_text', 'link', 'number', 'new_account']) assert.ok(strings.admin.spam.reasons[k]);
});
test('mergeSpam adds reasons and defaults to none', () => {
  const out = mergeSpam([{ id: 'a', status: 'reported' }, { id: 'b', status: 'reported' }], [{ issue_id: 'a', score: 3, reasons: ['link', 'number'] }]);
  assert.deepEqual(out[0].spam_reasons, ['link', 'number']); assert.equal(out[0].spam_score, 3);
  assert.deepEqual(out[1].spam_reasons, []); assert.equal(out[1].spam_score, 0);
  assert.deepEqual(mergeSpam([{ id: 'a' }], undefined)[0].spam_reasons, []);
  assert.deepEqual(mergeSpam([{ id: 'a' }], { message: 'not a list' })[0].spam_reasons, []);
});
test('only open reports with reasons count as suspicious', () => {
  assert.equal(isSuspicious({ status: 'reported', spam_reasons: ['link'] }), true);
  assert.equal(isSuspicious({ status: 'rejected', spam_reasons: ['link'] }), false);
  assert.equal(isSuspicious({ status: 'reported', spam_reasons: [] }), false);
  assert.equal(isSuspicious({ status: 'reported' }), false);
});
