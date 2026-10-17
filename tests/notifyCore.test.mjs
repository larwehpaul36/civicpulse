// Run: npm test
// The `notify` Edge Function's logic with fake push, email and database. It cannot show that a real push
// service or mail provider accepts the messages: that needs a live run (see supabase/functions/notify/README.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleEvent, MESSAGES, TITLE } from '../supabase/functions/notify/core.js';

const SITE = 'https://civic.test';
const ISSUE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const note = (to_status = 'sent', user_id = 'u1') => ({ type: 'INSERT', table: 'notifications', record: { id: 'n1', user_id, issue_id: ISSUE, to_status } });

function setup({ subs = [], contact = null, pushError = () => null, emailError = null, push = true, email = true } = {}) {
  const log = { push: [], email: [], deleted: [] };
  const deps = {
    siteUrl: SITE,
    db: {
      pushSubscriptions: async () => subs,
      deletePushSubscription: async (endpoint) => { log.deleted.push(endpoint); },
      contact: async () => contact,
    },
    sendPush: push ? async (sub, payload) => {
      const err = pushError(sub);
      if (err) throw err;
      log.push.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    } : undefined,
    sendEmail: email ? async (mail) => {
      if (emailError) throw emailError;
      log.email.push(mail);
    } : undefined,
  };
  return { deps, log };
}
const sub = (n) => ({ endpoint: `https://push.example/${n}`, p256dh: 'k', auth: 'a' });

test('a status change sends a push with the message and the report address', async () => {
  const { deps, log } = setup({ subs: [sub(1), sub(2)] });
  const result = await handleEvent(note('resolved'), deps);
  assert.deepEqual(result, { pushed: 2, removed: 0, emailed: 0, failed: 0 });
  assert.equal(log.push[0].payload.title, TITLE);
  assert.equal(log.push[0].payload.body, MESSAGES.resolved);
  assert.equal(log.push[0].payload.url, `/issues/${ISSUE}`);
  assert.equal(log.push[0].payload.tag, `issue-${ISSUE}`);
});

test('every real status has a message; unknown ones and "reported" send nothing', async () => {
  for (const status of ['verified', 'sent', 'in_progress', 'resolved', 'rejected']) assert.ok(MESSAGES[status], status);
  const { deps, log } = setup({ subs: [sub(1)] });
  assert.deepEqual(await handleEvent(note('reported'), deps), { ignored: true });
  assert.deepEqual(await handleEvent(note('mystery'), deps), { ignored: true });
  assert.equal(log.push.length, 0);
});

test('subscriptions the browser has dropped (404/410) are deleted; other failures are kept and counted', async () => {
  const { deps, log } = setup({
    subs: [sub(1), sub(2), sub(3)],
    pushError: (s) => (s.endpoint.endsWith('/1') ? Object.assign(new Error('gone'), { statusCode: 410 })
      : s.endpoint.endsWith('/2') ? Object.assign(new Error('busy'), { statusCode: 503 }) : null),
  });
  const result = await handleEvent(note(), deps);
  assert.deepEqual(result, { pushed: 1, removed: 1, emailed: 0, failed: 1 });
  assert.deepEqual(log.deleted, ['https://push.example/1']);
});

test('email goes only to a verified address, with a working stop link', async () => {
  const verified = { email: 'ama@example.com', verified_at: '2026-10-16T00:00:00Z', unsubscribe_token: 'tok-1' };
  const a = setup({ contact: verified });
  assert.equal((await handleEvent(note('sent'), a.deps)).emailed, 1);
  const mail = a.log.email[0];
  assert.equal(mail.to, 'ama@example.com');
  assert.ok(mail.text.includes(MESSAGES.sent));
  assert.ok(mail.text.includes(`${SITE}/issues/${ISSUE}`));
  assert.ok(mail.text.includes(`${SITE}/unsubscribe?t=tok-1`));
  assert.equal(mail.headers['List-Unsubscribe'], `<${SITE}/unsubscribe?t=tok-1>`);

  const unverified = setup({ contact: { ...verified, verified_at: null } });
  assert.equal((await handleEvent(note(), unverified.deps)).emailed, 0);
  assert.equal(unverified.log.email.length, 0);
  const none = setup({ contact: null });
  assert.equal((await handleEvent(note(), none.deps)).emailed, 0);
});

test('a failing email does not stop the push, and is counted', async () => {
  const { deps, log } = setup({ subs: [sub(1)], contact: { email: 'a@b.co', verified_at: 'x', unsubscribe_token: 't' }, emailError: new Error('provider down') });
  assert.deepEqual(await handleEvent(note(), deps), { pushed: 1, removed: 0, emailed: 0, failed: 1 });
  assert.equal(log.push.length, 1);
});

test('a channel that is not set up is skipped quietly', async () => {
  const noPush = setup({ subs: [sub(1)], push: false, contact: { email: 'a@b.co', verified_at: 'x', unsubscribe_token: 't' } });
  assert.deepEqual(await handleEvent(note(), noPush.deps), { pushed: 0, removed: 0, emailed: 1, failed: 0 });
  const noEmail = setup({ subs: [sub(1)], email: false, contact: { email: 'a@b.co', verified_at: 'x', unsubscribe_token: 't' } });
  assert.deepEqual(await handleEvent(note(), noEmail.deps), { pushed: 1, removed: 0, emailed: 0, failed: 0 });
});

test('a new or changed address gets one confirmation email; confirmed ones and other events are ignored', async () => {
  const contactEvent = (type, extra = {}) => ({ type, table: 'notification_contacts', record: { email: 'ama@example.com', verify_token: 'v-1', verified_at: null, ...extra } });
  for (const type of ['INSERT', 'UPDATE']) {
    const { deps, log } = setup();
    assert.deepEqual(await handleEvent(contactEvent(type), deps), { verificationSent: true });
    assert.equal(log.email[0].to, 'ama@example.com');
    assert.ok(log.email[0].text.includes(`${SITE}/confirm-email?t=v-1`));
  }
  const { deps, log } = setup();
  assert.deepEqual(await handleEvent(contactEvent('UPDATE', { verified_at: '2026-10-16' }), deps), { ignored: true });
  assert.deepEqual(await handleEvent(contactEvent('DELETE'), deps), { ignored: true });
  assert.deepEqual(await handleEvent({ type: 'INSERT', table: 'something_else', record: {} }, deps), { ignored: true });
  assert.deepEqual(await handleEvent(undefined, deps), { ignored: true });
  assert.equal(log.email.length, 0);
});

test('a failed confirmation email is reported, not thrown', async () => {
  const { deps } = setup({ emailError: new Error('down') });
  const result = await handleEvent({ type: 'INSERT', table: 'notification_contacts', record: { email: 'a@b.co', verify_token: 'v', verified_at: null } }, deps);
  assert.deepEqual(result, { verificationSent: false, failed: 1 });
});
