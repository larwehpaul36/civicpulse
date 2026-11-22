import test from 'node:test';
import assert from 'node:assert/strict';
import { requestCode, confirmCode, needsPhone } from '../lib/verifyFlow.js';

const PHONE = '+233241234567';
function fake({ update = null, signIn = null, verify = null } = {}) {
  const calls = [];
  return {
    calls,
    auth: {
      updateUser: async (a) => { calls.push(['updateUser', a]); return { error: update }; },
      signInWithOtp: async (a) => { calls.push(['signInWithOtp', a]); return { error: signIn }; },
      verifyOtp: async (a) => { calls.push(['verifyOtp', a]); return { error: verify }; },
    },
  };
}

test('the phone is first linked to this device\'s own account, so reports stay theirs', async () => {
  const sb = fake();
  assert.deepEqual(await requestCode(sb, PHONE), { mode: 'link' });
  assert.deepEqual(sb.calls, [['updateUser', { phone: PHONE }]]);
});

test('a phone that already belongs to an account signs in to it instead', async () => {
  const sb = fake({ update: { code: 'phone_exists', message: 'Phone number already registered' } });
  assert.deepEqual(await requestCode(sb, PHONE), { mode: 'signin' });
  assert.equal(sb.calls[1][0], 'signInWithOtp');
});

test('send problems become plain reasons', async () => {
  assert.deepEqual(await requestCode(fake({ update: { status: 429, message: 'over_sms_send_rate_limit' } }), PHONE), { error: 'rateLimit' });
  assert.deepEqual(await requestCode(fake({ update: { message: 'Error sending sms' } }), PHONE), { error: 'sendFailed' });
  assert.deepEqual(await requestCode(fake({ update: { code: 'phone_exists' }, signIn: { status: 429 } }), PHONE), { error: 'rateLimit' });
});

test('the code is checked with the right type for each way in', async () => {
  const link = fake(), signin = fake();
  assert.deepEqual(await confirmCode(link, { phone: PHONE, token: '123456', mode: 'link' }), { ok: true });
  assert.deepEqual(link.calls[0], ['verifyOtp', { phone: PHONE, token: '123456', type: 'phone_change' }]);
  await confirmCode(signin, { phone: PHONE, token: '123456', mode: 'signin' });
  assert.equal(signin.calls[0][1].type, 'sms');
});

test('wrong or expired codes count as a wrong try; other failures do not', async () => {
  const v = (verify) => confirmCode(fake({ verify }), { phone: PHONE, token: '000000', mode: 'link' });
  assert.deepEqual(await v({ code: 'otp_expired', message: 'Token has expired or is invalid' }), { error: 'wrong' });
  assert.deepEqual(await v({ status: 429 }), { error: 'rateLimit' });
  assert.deepEqual(await v({ message: 'something else broke' }), { error: 'generic' });
});

test('a refusal for a missing phone check is recognised', () => {
  assert.equal(needsPhone({ code: 'PV001' }), true);
  assert.equal(needsPhone({ message: 'phone_verification_required' }), true);
  assert.equal(needsPhone({ code: '23505' }), false);
  assert.equal(needsPhone(null), false);
});

// ---- bringing this phone's reports along when the number belongs to another account (migration 024) ----
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), size: () => m.size, m }; };
function withRpc(base, rpcResults) {
  const calls = [];
  base.rpc = async (name, args) => { calls.push([name, args]); return rpcResults[name] ?? { data: null, error: null }; };
  base.rpcCalls = calls;
  return base;
}

test('number already used: a merge ticket is made BEFORE signing in to the other account', async () => {
  const storage = memory();
  const sb = withRpc(fake({ update: { code: 'phone_exists' } }), { create_merge_ticket: { data: 'tick', error: null } });
  assert.deepEqual(await requestCode(sb, PHONE, { storage, now: 1 }), { mode: 'signin' });
  assert.deepEqual(sb.rpcCalls, [['create_merge_ticket', undefined]]);
  assert.deepEqual(JSON.parse(storage.m.get('civicpulse.mergeTicket')), { ticket: 'tick', phone: PHONE, at: 1 });
  const order = []; // the ticket must exist before the sign-in code is sent, because signing in replaces this phone's session
  const sb2 = fake({ update: { code: 'phone_exists' } });
  sb2.rpc = async () => { order.push('ticket'); return { data: 't', error: null }; };
  const send = sb2.auth.signInWithOtp; sb2.auth.signInWithOtp = async (a) => { order.push('signIn'); return send(a); };
  await requestCode(sb2, PHONE, { storage: memory() });
  assert.deepEqual(order, ['ticket', 'signIn']);
});

test('a ticket that cannot be made never stops the sign-in', async () => {
  const sb = withRpc(fake({ update: { code: 'phone_exists' } }), { create_merge_ticket: { data: null, error: { message: 'boom' } } });
  assert.deepEqual(await requestCode(sb, PHONE, { storage: memory() }), { mode: 'signin' });
  assert.deepEqual(await requestCode(fake({ update: { code: 'phone_exists' } }), PHONE, { storage: null }), { mode: 'signin' }, 'no storage at all');
});

test('the first, normal path (phone linked to this device) makes no ticket', async () => {
  const sb = withRpc(fake(), {});
  assert.deepEqual(await requestCode(sb, PHONE, { storage: memory() }), { mode: 'link' });
  assert.equal(sb.rpcCalls.length, 0);
});

test('after the sign-in code is confirmed, the ticket is handed over and the number of moved reports is reported', async () => {
  const storage = memory();
  storage.setItem('civicpulse.mergeTicket', JSON.stringify({ ticket: 'tick', phone: PHONE, at: Date.now() }));
  const sb = withRpc(fake(), { claim_merge_ticket: { data: { moved: 3 }, error: null } });
  assert.deepEqual(await confirmCode(sb, { phone: PHONE, token: '123456', mode: 'signin' }, { storage }), { ok: true, moved: 3 });
  assert.deepEqual(sb.rpcCalls, [['claim_merge_ticket', { p_ticket: 'tick' }]]);
  assert.equal(storage.size(), 0);
});

test('linking the phone to this device claims nothing, and a failed hand-over never undoes a good sign-in', async () => {
  const sb = withRpc(fake(), {});
  assert.deepEqual(await confirmCode(sb, { phone: PHONE, token: '123456', mode: 'link' }), { ok: true });
  assert.equal(sb.rpcCalls.length, 0);
  const storage = memory();
  storage.setItem('civicpulse.mergeTicket', JSON.stringify({ ticket: 'tick', phone: PHONE, at: Date.now() }));
  const broken = fake(); broken.rpc = async () => { throw new Error('offline'); };
  assert.deepEqual(await confirmCode(broken, { phone: PHONE, token: '1', mode: 'signin' }, { storage }), { ok: true, moved: 0 });
  assert.equal(storage.size(), 1, 'kept to try again');
  assert.deepEqual(await confirmCode(fake({ verify: { message: 'Token has expired or is invalid' } }), { phone: PHONE, token: '1', mode: 'signin' }), { error: 'wrong' });
});
