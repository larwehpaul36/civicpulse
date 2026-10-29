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
