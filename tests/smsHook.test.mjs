import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { verifySignature, handleSendSms, smsText } from '../lib/smsHook.js';

const KEY = randomBytes(24);
const SECRET = `v1,whsec_${KEY.toString('base64')}`;
const NOW = Date.UTC(2026, 9, 20, 12);
const ENV = { SEND_SMS_HOOK_SECRET: SECRET, ARKESEL_API_KEY: 'test-key', ARKESEL_SENDER_ID: 'CivicPulse' };

function signed(payload, { id = 'msg_1', ts = Math.floor(NOW / 1000), key = KEY } = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const sig = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  return { body, headers: { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${sig}` } };
}
const hook = (phone = '+233241234567', otp = '482915') => ({ user: { id: 'u1', phone }, sms: { otp } });
const arkesel = (out = { status: 'success', data: [{ recipient: '233241234567', id: 'x' }] }, ok = true) => {
  const seen = [];
  return { seen, fetchImpl: async (url, init) => { seen.push({ url, init }); return { ok, status: ok ? 200 : 500, json: async () => out }; } };
};

test('only correctly signed, recent requests are accepted', () => {
  const { body, headers } = signed(hook());
  const base = { id: headers['webhook-id'], timestamp: headers['webhook-timestamp'], signature: headers['webhook-signature'], body, secret: SECRET, now: NOW };
  assert.equal(verifySignature(base), true);
  assert.equal(verifySignature({ ...base, body: body + ' ' }), false, 'changed body');
  assert.equal(verifySignature({ ...base, secret: `v1,whsec_${randomBytes(24).toString('base64')}` }), false, 'wrong secret');
  assert.equal(verifySignature({ ...base, now: NOW + 10 * 60 * 1000 }), false, 'too old');
  assert.equal(verifySignature({ ...base, signature: '' }), false);
  assert.equal(verifySignature({ ...base, signature: `v1,AAAA ${headers['webhook-signature']}` }), true, 'second signature in the list');
});

test('a valid request sends the code to Arkesel in the format its API expects', async () => {
  const a = arkesel();
  const r = await handleSendSms({ ...signed(hook()), env: ENV, fetchImpl: a.fetchImpl, now: NOW });
  assert.deepEqual([r.status, r.json], [200, {}]);
  const { url, init } = a.seen[0];
  assert.equal(url, 'https://sms.arkesel.com/api/v2/sms/send');
  assert.equal(init.headers['api-key'], 'test-key');
  const sent = JSON.parse(init.body);
  assert.deepEqual(sent.recipients, ['+233241234567']);
  assert.equal(sent.sender, 'CivicPulse');
  assert.equal(sent.message, smsText('482915'));
  assert.ok(sent.message.startsWith('482915'));
});

test('a number given without the plus sign works too', async () => {
  const a = arkesel();
  const r = await handleSendSms({ ...signed(hook('233501234567')), env: ENV, fetchImpl: a.fetchImpl, now: NOW });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(a.seen[0].init.body).recipients, ['+233501234567']);
});

test('bad signatures, old requests and non-Ghana numbers never reach Arkesel', async () => {
  const cases = [
    [{ ...signed(hook(), { key: randomBytes(24) }) }, 401],
    [{ ...signed(hook(), { ts: Math.floor(NOW / 1000) - 3600 }) }, 401],
    [{ body: '{}', headers: {} }, 401],
    [{ ...signed(hook('+14155550100')) }, 400],
    [{ ...signed(hook('+233241234567', 'abc')) }, 400],
    [{ ...signed('not json') }, 400],
  ];
  for (const [req, status] of cases) {
    const a = arkesel();
    const r = await handleSendSms({ ...req, env: ENV, fetchImpl: a.fetchImpl, now: NOW });
    assert.equal(r.status, status);
    assert.equal(a.seen.length, 0, 'nothing sent');
  }
});

test('provider trouble is reported without leaking the key, the code or the number', async () => {
  for (const out of [{ status: 'error', message: 'Insufficient balance' }, { status: 'success', data: [{ 'invalid numbers': ['233241234567'] }] }]) {
    const r = await handleSendSms({ ...signed(hook()), env: ENV, fetchImpl: arkesel(out).fetchImpl, now: NOW });
    assert.equal(r.status, 500);
    const text = JSON.stringify(r.json);
    assert.ok(!text.includes('test-key') && !text.includes('482915') && !text.includes('233241234567'));
  }
  const down = await handleSendSms({ ...signed(hook()), env: ENV, fetchImpl: async () => { throw new Error('network'); }, now: NOW });
  assert.equal(down.status, 500);
});

test('without its settings the endpoint says it is not set up and sends nothing', async () => {
  const a = arkesel();
  const r = await handleSendSms({ ...signed(hook()), env: {}, fetchImpl: a.fetchImpl, now: NOW });
  assert.equal(r.status, 500);
  assert.equal(a.seen.length, 0);
});
