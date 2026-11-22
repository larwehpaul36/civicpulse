import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isToken, linkUrl, linkErrorKey, loadLinkInfo, replyViaLink, makeReplyLink, revokeReplyLinks } from '../lib/replyLinks.js';
import { loadReplies } from '../lib/officeReplies.js';
import { strings } from '../lib/strings.js';

const TOKEN = 'a'.repeat(64);
const TODAY = '2026-11-20';
const fake = ({ data = null, error = null, throws = false } = {}) => {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push([name, args]); if (throws) throw new Error('offline'); return { data, error }; } };
};

test('only a 64-character lowercase hex secret counts as a link', () => {
  assert.equal(isToken(TOKEN), true);
  for (const bad of ['', 'nonsense', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), null, undefined, 12, `${'a'.repeat(63)}g`]) assert.equal(isToken(bad), false, String(bad));
});

test('the link address is the site, /reply/, then the secret, with no doubled slash', () => {
  assert.equal(linkUrl('https://civicpulse.example', TOKEN), `https://civicpulse.example/reply/${TOKEN}`);
  assert.equal(linkUrl('https://civicpulse.example/', TOKEN), `https://civicpulse.example/reply/${TOKEN}`);
});

test('database error words map to keys, and anything else is "failed"', () => {
  assert.equal(linkErrorKey({ message: 'link_invalid' }), 'link_invalid');
  assert.equal(linkErrorKey({ message: 'x', details: 'rate_limited' }), 'rate_limited');
  assert.equal(linkErrorKey({ message: 'weird' }), 'failed');
  assert.equal(linkErrorKey(null), 'failed');
});

test('junk links never reach the database', async () => {
  const sb = fake();
  assert.deepEqual(await loadLinkInfo(sb, 'nonsense'), { error: 'link_invalid' });
  assert.deepEqual(await replyViaLink(sb, 'nonsense', { kind: 'reply', body: 'x' }, TODAY), { error: 'link_invalid' });
  assert.equal(sb.calls.length, 0);
});

test('loading a link: a row means good, no row means a bad link, an error means "try again"', async () => {
  assert.equal((await loadLinkInfo(fake({ data: [{ issue_id: 'i1', party_name: 'A' }] }), TOKEN)).info.issue_id, 'i1');
  assert.deepEqual(await loadLinkInfo(fake({ data: [] }), TOKEN), { error: 'link_invalid' });
  assert.deepEqual(await loadLinkInfo(fake({ data: null }), TOKEN), { error: 'link_invalid' });
  assert.deepEqual(await loadLinkInfo(fake({ error: { message: 'boom' } }), TOKEN), { error: 'failed' });
});

test('replying checks the same rules as the database before sending, and sends trimmed text', async () => {
  const sb = fake();
  assert.deepEqual(await replyViaLink(sb, TOKEN, { kind: 'reply', body: '   ' }, TODAY), { error: 'text_required' });
  assert.deepEqual(await replyViaLink(sb, TOKEN, { kind: 'expected_date', expected: '' }, TODAY), { error: 'date_required' });
  assert.deepEqual(await replyViaLink(sb, TOKEN, { kind: 'expected_date', expected: '2020-01-01' }, TODAY), { error: 'bad_date' });
  assert.deepEqual(await replyViaLink(sb, TOKEN, { kind: 'reply', body: 'x'.repeat(501) }, TODAY), { error: 'too_long' });
  assert.equal(sb.calls.length, 0, 'bad input is stopped on the page');
  assert.deepEqual(await replyViaLink(sb, TOKEN, { kind: 'reply', body: '  On Friday.  ', expected: '2026-12-01' }, TODAY), { ok: true });
  assert.deepEqual(sb.calls[0], ['office_reply_via_link', { p_token: TOKEN, p_kind: 'reply', p_body: 'On Friday.', p_expected: null }]);
  await replyViaLink(sb, TOKEN, { kind: 'expected_date', expected: '2026-12-01' }, TODAY);
  assert.equal(sb.calls[1][1].p_expected, '2026-12-01');
  assert.equal(sb.calls[1][1].p_body, null);
});

test('the database saying the link is bad or the limit is hit comes back as a key', async () => {
  assert.deepEqual(await replyViaLink(fake({ error: { message: 'link_invalid' } }), TOKEN, { kind: 'reply', body: 'x' }, TODAY), { error: 'link_invalid' });
  assert.deepEqual(await replyViaLink(fake({ error: { message: 'rate_limited' } }), TOKEN, { kind: 'reply', body: 'x' }, TODAY), { error: 'rate_limited' });
});

test('making and switching off links never throws, so a missing migration only means "no link"', async () => {
  assert.deepEqual(await makeReplyLink(fake({ data: TOKEN }), 'i1'), { token: TOKEN });
  assert.deepEqual(await makeReplyLink(fake({ data: 'short' }), 'i1'), { error: 'failed' });
  assert.deepEqual(await makeReplyLink(fake({ error: { message: 'function admin_make_reply_link does not exist' } }), 'i1'), { error: 'failed' });
  assert.deepEqual(await makeReplyLink(fake({ error: { message: 'no_party' } }), 'i1'), { error: 'no_party' });
  assert.deepEqual(await makeReplyLink(fake({ throws: true }), 'i1'), { error: 'failed' });
  assert.deepEqual(await revokeReplyLinks(fake({ data: 3 }), 'i1'), { count: 3 });
  assert.deepEqual(await revokeReplyLinks(fake({ throws: true }), 'i1'), { error: 'failed' });
});

test('replies still load before migration 025: the missing "source" column is retried without', async () => {
  const asked = [];
  const sb = { from: () => ({ select: (cols) => { asked.push(cols); return { eq: () => ({ order: async () => (cols.includes('source') ? { data: null, error: { message: 'column source does not exist' } } : { data: [{ id: 1 }], error: null }) }) }; } }) };
  assert.equal((await loadReplies(sb, 'x')).length, 1);
  assert.equal(asked.length, 2);
  assert.ok(asked[0].includes('source') && !asked[1].includes('source'));
});

test('the message to the office carries the reply link only when there is one', () => {
  const base = { party: 'Test Assembly', category: 'Pothole', severity: 'High', days: 3, confirmations: 2, mapUrl: 'm', reportUrl: 'r' };
  const without = strings.admin.escalationMessage(base);
  const withLink = strings.admin.escalationMessage({ ...base, replyUrl: `https://x.example/reply/${TOKEN}` });
  assert.ok(!without.includes('/reply/'));
  assert.ok(withLink.includes(`https://x.example/reply/${TOKEN}`));
  assert.ok(without.includes('Please reply with when it will be fixed.'));
});

test('the office page is private: not indexed, no referrer, and no secret ever logged', () => {
  const layout = readFileSync(new URL('../app/reply/layout.js', import.meta.url), 'utf8');
  assert.ok(/index:\s*false/.test(layout) && /referrer:\s*'no-referrer'/.test(layout));
  const page = readFileSync(new URL('../app/reply/[token]/page.js', import.meta.url), 'utf8');
  assert.ok(!/console\.(log|error|warn)/.test(page), 'the page must not log (the address holds a secret)');
  assert.ok(page.includes('noValidate'));
});

test('a link reply is labelled as unverified, and the public footer explains both routes', () => {
  assert.ok(/not verified/i.test(strings.replies.viaLink));
  assert.ok(/private link/.test(strings.replies.about) && /passed on to us/.test(strings.replies.about));
});
