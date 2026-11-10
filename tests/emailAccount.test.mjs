import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountState, addEmailOrSignIn, cleanEmail, explain, linkEmail, looksLikeEmail, requestSignIn, signOutHere,
} from '../lib/emailAccount.js';

const URL_BACK = 'https://civicpulse.example/my';

// A stand-in Supabase client that records every auth call.
function fakeSupabase({ updateUser = { error: null }, signInWithOtp = { error: null } } = {}) {
  const calls = [];
  return {
    calls,
    auth: {
      updateUser: async (...args) => { calls.push(['updateUser', ...args]); return updateUser; },
      signInWithOtp: async (...args) => { calls.push(['signInWithOtp', ...args]); return signInWithOtp; },
      signOut: async (...args) => { calls.push(['signOut', ...args]); return { error: null }; },
    },
  };
}

test('email addresses are tidied and checked before anything is sent', () => {
  assert.equal(cleanEmail('  Ama@Example.COM '), 'ama@example.com');
  assert.equal(cleanEmail(undefined), '');
  for (const ok of ['a@b.co', 'ama.mensah+reports@mail.example.org']) assert.equal(looksLikeEmail(ok), true, ok);
  for (const bad of ['', 'ama', 'ama@', '@b.co', 'a b@c.co', 'a@b', `${'x'.repeat(250)}@b.co`]) assert.equal(looksLikeEmail(bad), false, bad);
});

test('the account state follows the CONFIRMED email, whatever the is_anonymous flag says', () => {
  assert.deepEqual(accountState(null), { kind: 'none' });
  assert.deepEqual(accountState({ is_anonymous: true }), { kind: 'anonymous' });
  assert.deepEqual(accountState({ is_anonymous: true, email: '', new_email: 'a@b.co' }), { kind: 'pending', email: 'a@b.co' });
  assert.deepEqual(accountState({ is_anonymous: false, email: 'a@b.co', email_confirmed_at: '2026-11-05T10:00:00Z' }), { kind: 'signedIn', email: 'a@b.co' });
  // Supabase may or may not flip is_anonymous after confirming; both must read as signed in
  assert.deepEqual(accountState({ is_anonymous: true, email: 'a@b.co', email_confirmed_at: '2026-11-05T10:00:00Z' }), { kind: 'signedIn', email: 'a@b.co' });
  // an address that is set but not confirmed is not "signed in"
  assert.deepEqual(accountState({ is_anonymous: true, email: 'a@b.co' }), { kind: 'anonymous' });
});

test('Supabase errors become short codes, and set-up problems are told apart', () => {
  assert.equal(explain({ code: 'email_exists' }), 'email_taken');
  assert.equal(explain({ message: 'A user with this email address has already been registered' }), 'email_taken');
  assert.equal(explain({ code: 'over_email_send_rate_limit', status: 429 }), 'too_soon');
  assert.equal(explain({ message: 'For security purposes, you can only request this after 52 seconds.' }), 'too_soon');
  assert.equal(explain({ code: 'email_address_invalid' }), 'bad_email');
  assert.equal(explain({ code: 'email_address_not_authorized' }), 'email_off'); // the built-in mail service refusing a non-team address
  assert.equal(explain({ code: 'manual_linking_disabled' }), 'email_off');
  assert.equal(explain({ message: 'something nobody expected' }), 'failed');
  assert.equal(explain(null), 'failed');
});

test('adding an email makes sure there is an account, then attaches the address to it', async () => {
  const db = fakeSupabase();
  const order = [];
  const ensureUser = async () => { order.push('ensureUser'); };
  db.auth.updateUser = async (...a) => { order.push('updateUser'); db.calls.push(['updateUser', ...a]); return { error: null }; };
  const sent = await linkEmail({ supabase: db, ensureUser }, '  Kofi@Example.com ', URL_BACK);
  assert.equal(sent, 'kofi@example.com');
  assert.deepEqual(order, ['ensureUser', 'updateUser']);
  assert.deepEqual(db.calls, [['updateUser', { email: 'kofi@example.com' }, { emailRedirectTo: URL_BACK }]]);
});

test('a bad address never reaches the network', async () => {
  const db = fakeSupabase();
  let ensured = 0;
  await assert.rejects(linkEmail({ supabase: db, ensureUser: async () => { ensured += 1; } }, 'not-an-email', URL_BACK), /bad_email/);
  await assert.rejects(requestSignIn({ supabase: db, getCaptchaToken: async () => { ensured += 1; } }, '', URL_BACK), /bad_email/);
  assert.equal(db.calls.length, 0);
  assert.equal(ensured, 0);
});

test('adding an email reports an address that already has an account, and rate limits, with the right codes', async () => {
  for (const [error, code] of [[{ code: 'email_exists' }, 'email_taken'], [{ code: 'over_email_send_rate_limit' }, 'too_soon'], [{ code: 'manual_linking_disabled' }, 'email_off']]) {
    const db = fakeSupabase({ updateUser: { error } });
    await assert.rejects(linkEmail({ supabase: db, ensureUser: async () => {} }, 'a@b.co', URL_BACK), (e) => e.message === code && e.cause === error);
  }
});

test('signing in on a new phone never creates an account, and passes the bot check only when it is on', async () => {
  let db = fakeSupabase();
  await requestSignIn({ supabase: db, getCaptchaToken: async () => 'tok' }, 'A@B.co', URL_BACK);
  assert.deepEqual(db.calls[0], ['signInWithOtp', { email: 'a@b.co', options: { shouldCreateUser: false, emailRedirectTo: URL_BACK, captchaToken: 'tok' } }]);
  db = fakeSupabase();
  await requestSignIn({ supabase: db, getCaptchaToken: async () => undefined }, 'a@b.co', URL_BACK);
  assert.deepEqual(db.calls[0][1].options, { shouldCreateUser: false, emailRedirectTo: URL_BACK }, 'no captchaToken key when the check is off');
});

test('an address with no account looks exactly like one that has an account', async () => {
  for (const error of [{ code: 'otp_disabled', message: 'Signups not allowed for otp', status: 422 }, { message: 'Signups not allowed for otp' }]) {
    const db = fakeSupabase({ signInWithOtp: { error } });
    assert.equal(await requestSignIn({ supabase: db, getCaptchaToken: async () => undefined }, 'nobody@b.co', URL_BACK), 'nobody@b.co');
  }
});

test('real sign-in failures are still reported, and a failed bot check sends nothing', async () => {
  const db = fakeSupabase({ signInWithOtp: { error: { code: 'over_email_send_rate_limit' } } });
  await assert.rejects(requestSignIn({ supabase: db, getCaptchaToken: async () => undefined }, 'a@b.co', URL_BACK), /too_soon/);
  const quiet = fakeSupabase();
  await assert.rejects(requestSignIn({ supabase: quiet, getCaptchaToken: async () => { throw new Error('captcha_timeout'); } }, 'a@b.co', URL_BACK), /captcha_timeout/);
  assert.equal(quiet.calls.length, 0);
});

test('signing out only ends this phone, never the person\'s other phones', async () => {
  const db = fakeSupabase();
  await signOutHere(db);
  assert.deepEqual(db.calls, [['signOut', { scope: 'local' }]]);
});

test('the feature is OFF unless NEXT_PUBLIC_EMAIL_ACCOUNTS is exactly 1', async () => {
  const load = async (v) => {
    if (v === undefined) delete process.env.NEXT_PUBLIC_EMAIL_ACCOUNTS; else process.env.NEXT_PUBLIC_EMAIL_ACCOUNTS = v;
    return (await import(`../lib/emailAccount.js?flag=${v}-${Math.random()}`)).EMAIL_ACCOUNTS;
  };
  assert.equal(await load(undefined), false);
  assert.equal(await load('0'), false);
  assert.equal(await load('true'), false);
  assert.equal(await load('1'), true);
  delete process.env.NEXT_PUBLIC_EMAIL_ACCOUNTS;
});

test('an address that already has an account gets a sign-in link instead, after the reports are made ready', async () => {
  const db = fakeSupabase({ updateUser: { error: { code: 'email_exists' } } });
  const order = [];
  const prepare = async (address) => { order.push(['prepare', address]); };
  const sent = await addEmailOrSignIn({ supabase: db, ensureUser: async () => {}, getCaptchaToken: async () => 'tok', prepare }, ' Ama@Example.com', URL_BACK);
  assert.equal(sent, 'ama@example.com');
  assert.deepEqual(order, [['prepare', 'ama@example.com']]);
  assert.deepEqual(db.calls.map((c) => c[0]), ['updateUser', 'signInWithOtp']);
  assert.deepEqual(db.calls[1][1].options, { shouldCreateUser: false, emailRedirectTo: URL_BACK, captchaToken: 'tok' });
});

test('a new address and an existing one give the caller the same answer', async () => {
  const fresh = await addEmailOrSignIn({ supabase: fakeSupabase(), ensureUser: async () => {}, getCaptchaToken: async () => undefined }, 'a@b.co', URL_BACK);
  const taken = await addEmailOrSignIn({ supabase: fakeSupabase({ updateUser: { error: { code: 'email_exists' } } }), ensureUser: async () => {}, getCaptchaToken: async () => undefined }, 'a@b.co', URL_BACK);
  assert.equal(fresh, taken);
});

test('if the reports cannot be made ready, no sign-in link is sent', async () => {
  const db = fakeSupabase({ updateUser: { error: { code: 'email_exists' } } });
  await assert.rejects(addEmailOrSignIn({ supabase: db, ensureUser: async () => {}, getCaptchaToken: async () => undefined, prepare: async () => { throw new Error('prepare_failed'); } }, 'a@b.co', URL_BACK), /prepare_failed/);
  assert.deepEqual(db.calls.map((c) => c[0]), ['updateUser']);
});

test('other problems when adding an email are not turned into a sign-in', async () => {
  const db = fakeSupabase({ updateUser: { error: { code: 'over_email_send_rate_limit' } } });
  await assert.rejects(addEmailOrSignIn({ supabase: db, ensureUser: async () => {}, getCaptchaToken: async () => undefined }, 'a@b.co', URL_BACK), /too_soon/);
  assert.deepEqual(db.calls.map((c) => c[0]), ['updateUser']);
});
