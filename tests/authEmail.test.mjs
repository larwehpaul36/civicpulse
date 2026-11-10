import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { handleSendEmail, recipients, verifyLink, mailText } from '../supabase/functions/auth-email/core.js';

const KEY = randomBytes(24);
const SECRET = `v1,whsec_${KEY.toString('base64')}`;
const NOW = Date.UTC(2026, 10, 5, 12);
const ENV = { SEND_EMAIL_HOOK_SECRET: SECRET, RESEND_API_KEY: 'rk', EMAIL_FROM: 'CivicPulse <login@example.org>', SUPABASE_URL: 'https://abc.supabase.co/' };

function signed(payload, { id = 'm1', ts = Math.floor(NOW / 1000), key = KEY } = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const sig = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  return { body, headers: { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${sig}` } };
}
const magic = (extra = {}) => ({
  user: { id: 'u1', email: 'ama@example.com', ...extra },
  email_data: { token: '123456', token_hash: 'hash_ok', redirect_to: 'https://civic.example/my', email_action_type: 'magiclink', site_url: 'https://civic.example', token_new: '', token_hash_new: '' },
});
function rig({ verdict = { allowed: true, reason: 'ok' }, dbThrows = false, provider = { ok: true, status: 200 } } = {}) {
  const sent = []; const asked = []; const logs = [];
  return {
    sent, asked, logs,
    db: { allow: async (...a) => { asked.push(a); if (dbThrows) throw new Error('db down'); return verdict; } },
    fetchImpl: async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return provider; },
    log: (...a) => logs.push(a.join(' ')),
  };
}
const run = (payload, r, opts) => handleSendEmail({ ...signed(payload, opts), env: ENV, db: r.db, fetchImpl: r.fetchImpl, now: NOW, log: r.log });

test('a sign-in link is checked against the limits, then sent', async () => {
  const r = rig();
  const out = await run(magic(), r);
  assert.equal(out.status, 200);
  assert.deepEqual(r.asked, [['u1', 'ama@example.com', 'magiclink']]);
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].url, 'https://api.resend.com/emails');
  assert.deepEqual(r.sent[0].body.to, ['ama@example.com']);
  assert.match(r.sent[0].body.text, /^Open this link on your phone to sign in:\n\nhttps:\/\/abc\.supabase\.co\/auth\/v1\/verify\?token=hash_ok&type=magiclink&redirect_to=https%3A%2F%2Fcivic\.example%2Fmy\n/);
});

test('over the limit: nothing is sent and the answer is 429', async () => {
  const r = rig({ verdict: { allowed: false, reason: 'user' } });
  const out = await run(magic(), r);
  assert.equal(out.status, 429);
  assert.equal(r.sent.length, 0);
  assert.ok(!r.logs.join('\n').includes('ama@example.com'), 'the address is never logged');
});

test('if the limit check itself breaks, the email is still sent', async () => {
  const r = rig({ dbThrows: true });
  const out = await run(magic(), r);
  assert.equal(out.status, 200);
  assert.equal(r.sent.length, 1);
});

test('a bad or stale signature is refused before anything happens', async () => {
  for (const opts of [{ key: randomBytes(24) }, { ts: Math.floor(NOW / 1000) - 3600 }]) {
    const r = rig();
    assert.equal((await run(magic(), r, opts)).status, 401);
    assert.equal(r.asked.length + r.sent.length, 0);
  }
  const r = rig();
  const out = await handleSendEmail({ body: JSON.stringify(magic()), headers: {}, env: ENV, db: r.db, fetchImpl: r.fetchImpl, now: NOW, log: r.log });
  assert.equal(out.status, 401);
});

test('not set up yet: refuses with 500 and sends nothing', async () => {
  const r = rig();
  const out = await handleSendEmail({ ...signed(magic()), env: { ...ENV, RESEND_API_KEY: '' }, db: r.db, fetchImpl: r.fetchImpl, now: NOW, log: r.log });
  assert.equal(out.status, 500);
  assert.equal(r.sent.length, 0);
});

test('"your password changed"-style notices are not sent and never use the allowance', async () => {
  const r = rig();
  const p = magic(); p.email_data.email_action_type = 'email_changed_notification';
  assert.equal((await run(p, r)).status, 200);
  assert.equal(r.asked.length + r.sent.length, 0);
});

test('unknown types and malformed bodies are rejected', async () => {
  const r = rig();
  const p = magic(); p.email_data.email_action_type = 'something_new';
  assert.equal((await run(p, r)).status, 400);
  assert.equal((await run('not json', r)).status, 400);
  assert.equal((await run({ user: {}, email_data: {} }, r)).status, 400);
  assert.equal(r.sent.length, 0);
});

test('an email change from an anonymous phone goes only to the new address', async () => {
  const r = rig();
  const p = magic({ email: '', new_email: 'kofi@example.com' });
  p.email_data = { ...p.email_data, email_action_type: 'email_change', token_hash: 'hash_new', token_hash_new: '', token_new: '654321' };
  assert.equal((await run(p, r)).status, 200);
  assert.deepEqual(r.sent.map((s) => s.body.to), [['kofi@example.com']]);
  assert.match(r.sent[0].body.text, /confirm your email/);
  assert.match(r.sent[0].body.text, /token=hash_new&type=email_change/);
});

test('with a current and a new address, each gets the link that matches its own code', () => {
  const p = magic({ email: 'old@example.com', new_email: 'new@example.com' });
  p.email_data = { ...p.email_data, email_action_type: 'email_change', token_hash: 'for_new', token_hash_new: 'for_old' };
  assert.deepEqual(recipients(p).map((m) => [m.to, m.tokenHash]), [['new@example.com', 'for_new'], ['old@example.com', 'for_old']]);
});

test('every address is checked separately, and one refusal stops the rest', async () => {
  const r = rig({ verdict: { allowed: false, reason: 'address' } });
  const p = magic({ email: 'old@example.com', new_email: 'new@example.com' });
  p.email_data = { ...p.email_data, email_action_type: 'email_change', token_hash: 'a', token_hash_new: 'b' };
  assert.equal((await run(p, r)).status, 429);
  assert.equal(r.asked.length, 1);
  assert.equal(r.sent.length, 0);
});

test('a refusing mail provider is a 500, and the code is never shown in a link email', async () => {
  const r = rig({ provider: { ok: false, status: 403 } });
  assert.equal((await run(magic(), r)).status, 500);
  assert.ok(!mailText('magiclink', 'https://x', '123456').includes('123456'));
  assert.ok(mailText('reauthentication', null, '123456').includes('123456'));
});

test('links are built from the project address and are fully encoded', () => {
  assert.equal(verifyLink({ supabaseUrl: 'https://abc.supabase.co/', tokenHash: 'a b&c', type: 'magiclink', redirectTo: 'https://x.test/my?a=1&b=2' }),
    'https://abc.supabase.co/auth/v1/verify?token=a%20b%26c&type=magiclink&redirect_to=https%3A%2F%2Fx.test%2Fmy%3Fa%3D1%26b%3D2');
});
