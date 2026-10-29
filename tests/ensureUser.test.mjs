import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnsureUser } from '../lib/ensureUser.js';
import { getCaptchaToken, captchaEnabled } from '../lib/captcha.js';

const USER = { id: 'u1' };
function fake({ session = null, signIn = { data: { user: USER }, error: null } } = {}) {
  const calls = [];
  return {
    calls,
    auth: {
      getSession: async () => ({ data: { session } }),
      signInAnonymously: async (arg) => { calls.push(arg); await new Promise((r) => setTimeout(r, 5)); return signIn; },
    },
  };
}

test('someone already signed in is never asked to pass the check again', async () => {
  const sb = fake({ session: { user: USER } });
  let asked = 0;
  const ensure = createEnsureUser({ supabase: sb, getCaptchaToken: async () => { asked += 1; return 'tok'; } });
  assert.deepEqual(await ensure(), USER);
  assert.equal(asked, 0);
  assert.equal(sb.calls.length, 0);
});

test('with the check switched off, sign-in is exactly as before', async () => {
  const sb = fake();
  const ensure = createEnsureUser({ supabase: sb, getCaptchaToken: async () => undefined });
  assert.deepEqual(await ensure(), USER);
  assert.deepEqual(sb.calls, [undefined]);
});

test('with the check on, the one-time token goes along with the sign-in', async () => {
  const sb = fake();
  const ensure = createEnsureUser({ supabase: sb, getCaptchaToken: async () => 'tok-123' });
  await ensure();
  assert.deepEqual(sb.calls, [{ options: { captchaToken: 'tok-123' } }]);
});

test('two requests at the same moment create one account, and a later one can sign in again', async () => {
  const sb = fake();
  const ensure = createEnsureUser({ supabase: sb, getCaptchaToken: async () => undefined });
  const [a, b] = await Promise.all([ensure(), ensure()]);
  assert.equal(a, b);
  assert.equal(sb.calls.length, 1);
  await ensure();
  assert.equal(sb.calls.length, 2);
});

test('a failed check or a refused sign-in is reported, and never silently ignored', async () => {
  const sb = fake();
  const blocked = createEnsureUser({ supabase: sb, getCaptchaToken: async () => { throw new Error('captcha_failed'); } });
  await assert.rejects(blocked(), /captcha_failed/);
  assert.equal(sb.calls.length, 0, 'no sign-in attempted without a token');
  const refused = createEnsureUser({ supabase: fake({ signIn: { data: null, error: new Error('captcha verification process failed') } }), getCaptchaToken: async () => 'tok' });
  await assert.rejects(refused(), /captcha verification/);
});

test('the browser check does nothing until a site key is set', async () => {
  assert.equal(captchaEnabled, false);
  assert.equal(await getCaptchaToken(), undefined);
});
