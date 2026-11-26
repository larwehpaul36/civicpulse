import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addStaffReply, daysWaiting, inviteStaff, isOpen, listStaff, loadMyOffices, loadOfficeIssues, needsReply,
  normEmail, OFFICE_VIEWS, revokeStaff, sortForOffice, staffErrorKey, validEmail,
} from '../lib/officeStaff.js';
import { strings } from '../lib/strings.js';

const today = '2026-11-25';
const fake = (result) => { const calls = []; return { calls, rpc: async (name, args) => { calls.push([name, args]); return typeof result === 'function' ? result(name, args) : result; } }; };

test('emails are trimmed and lower-cased, and obviously wrong ones are refused', () => {
  assert.equal(normEmail('  Officer@GaEast.GOV.gh '), 'officer@gaeast.gov.gh');
  assert.equal(normEmail(null), '');
  for (const ok of ['a@b.co', 'officer@gaeast.gov.gh', ' A@B.CO ']) assert.equal(validEmail(ok), true, ok);
  for (const bad of ['', '  ', 'nope', 'a@b', 'a b@c.de', '@b.co', 'a@.co', null, undefined, `${'x'.repeat(250)}@b.co`]) assert.equal(validEmail(bad), false, String(bad));
});

test('database errors become friendly keys', () => {
  assert.equal(staffErrorKey({ message: 'ERROR: issue_not_found' }), 'issue_not_found');
  assert.equal(staffErrorKey({ message: 'x', details: 'not_open' }), 'not_open');
  assert.equal(staffErrorKey({ message: 'rate_limited' }), 'rate_limited');
  assert.equal(staffErrorKey({ message: 'too_many' }), 'too_many');
  assert.equal(staffErrorKey({ message: 'boom' }), 'failed');
  assert.equal(staffErrorKey(null), 'failed');
  for (const k of Object.keys(strings.office.errors)) assert.ok(strings.office.errors[k], k);
});

test('loading never throws: a missing migration or a network failure is just {error}', async () => {
  const bad = fake({ data: null, error: { message: 'function does not exist' } });
  assert.deepEqual(await loadMyOffices(bad), { error: 'failed' });
  assert.deepEqual(await loadOfficeIssues(bad), { error: 'failed' });
  assert.deepEqual(await listStaff(bad), { error: 'failed' });
  assert.deepEqual((await loadMyOffices(fake({ data: [{ party_id: 'p', name: 'A' }], error: null }))).offices, [{ party_id: 'p', name: 'A' }]);
  assert.deepEqual((await loadMyOffices(fake({ data: null, error: null }))).offices, []);
  assert.deepEqual((await loadOfficeIssues(fake({ data: 'weird', error: null }))).issues, []);
});

test('a reply is checked here first, then sent with only what its kind needs', async () => {
  const sb = fake({ error: null });
  assert.deepEqual(await addStaffReply(sb, 'i1', { kind: 'reply', body: '   ' }, today), { error: 'text_required' });
  assert.deepEqual(await addStaffReply(sb, 'i1', { kind: 'expected_date', expected: '2026-01-01' }, today), { error: 'bad_date' });
  assert.deepEqual(await addStaffReply(sb, 'i1', { kind: 'shout', body: 'x' }, today), { error: 'bad_kind' });
  assert.equal(sb.calls.length, 0, 'nothing reaches the database when the form is wrong');
  assert.deepEqual(await addStaffReply(sb, 'i1', { kind: 'reply', body: '  We will come  ', expected: '2026-12-01' }, today), { ok: true });
  assert.deepEqual(sb.calls[0], ['staff_add_reply', { p_issue: 'i1', p_kind: 'reply', p_body: 'We will come', p_expected: null }]);
  await addStaffReply(sb, 'i1', { kind: 'expected_date', body: '', expected: '2026-12-01' }, today);
  assert.deepEqual(sb.calls[1][1], { p_issue: 'i1', p_kind: 'expected_date', p_body: null, p_expected: '2026-12-01' });
  const refused = fake({ error: { message: 'not_open' } });
  assert.deepEqual(await addStaffReply(refused, 'i1', { kind: 'reply', body: 'x' }, today), { error: 'not_open' });
});

test('invites validate first, normalise the email, and report the database answer', async () => {
  const sb = fake({ error: null });
  assert.deepEqual(await inviteStaff(sb, 'nope', 'p1'), { error: 'bad_email' });
  assert.deepEqual(await inviteStaff(sb, 'a@b.co', ''), { error: 'party_not_found' });
  assert.equal(sb.calls.length, 0);
  assert.deepEqual(await inviteStaff(sb, '  Officer@GaEast.co ', 'p1'), { ok: true });
  assert.deepEqual(sb.calls[0], ['admin_invite_office_staff', { p_email: 'officer@gaeast.co', p_party: 'p1' }]);
  assert.deepEqual(await inviteStaff(fake({ error: { message: 'too_many' } }), 'a@b.co', 'p1'), { error: 'too_many' });
  assert.deepEqual(await inviteStaff(fake({ error: { message: 'not_moderator' } }), 'a@b.co', 'p1'), { error: 'not_moderator' });
  assert.deepEqual(await revokeStaff(sb, 'x1'), { ok: true });
  assert.deepEqual(sb.calls[1], ['admin_revoke_office_staff', { p_id: 'x1' }]);
  assert.deepEqual(await revokeStaff(fake({ error: { message: 'x' } }), 'x1'), { error: 'failed' });
});

test('reports sort into the right tab, and the ones waiting longest come first', () => {
  const r = (id, status, replies, sent) => ({ id, status, replies_count: replies, sent_at: sent, created_at: '2026-01-01T00:00:00Z' });
  const list = [r('new', 'sent', 0, '2026-11-20T00:00:00Z'), r('old', 'in_progress', 0, '2026-10-01T00:00:00Z'),
                r('done', 'resolved', 2, '2026-09-01T00:00:00Z'), r('talked', 'sent', 1, '2026-10-10T00:00:00Z')];
  assert.deepEqual(list.filter(OFFICE_VIEWS.waiting).map((x) => x.id), ['new', 'old']);
  assert.deepEqual(list.filter(OFFICE_VIEWS.replied).map((x) => x.id), ['talked']);
  assert.deepEqual(list.filter(OFFICE_VIEWS.fixed).map((x) => x.id), ['done']);
  assert.deepEqual(sortForOffice(list.filter(OFFICE_VIEWS.waiting)).map((x) => x.id), ['old', 'new']);
  assert.equal(isOpen(r('a', 'resolved', 0)), false);
  assert.equal(needsReply(r('a', 'sent', 0)), true);
  assert.equal(needsReply(r('a', 'sent', 3)), false);
  assert.equal(needsReply(r('a', 'resolved', 0)), false);
  const total = list.length; assert.equal(Object.values(OFFICE_VIEWS).reduce((n, fn) => n + list.filter(fn).length, 0), total, 'every report is in exactly one tab');
});

test('days waiting counts from when it was sent to the office, not from when it was reported', () => {
  const now = new Date('2026-11-25T12:00:00Z').getTime();
  assert.equal(daysWaiting({ sent_at: '2026-11-20T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }, now), 5);
  assert.equal(daysWaiting({ sent_at: null, created_at: '2026-11-24T00:00:00Z' }, now), 1);
  assert.equal(daysWaiting({ sent_at: '2026-11-26T00:00:00Z' }, now), 0);
  assert.equal(daysWaiting({ sent_at: 'garbage' }, now), 0);
});

test('office text: the invitation message names the office and the page, and nothing secret', () => {
  const m = strings.admin.staff.message('Ga East Assembly', 'https://civicpulse.example/office');
  assert.ok(m.includes('Ga East Assembly') && m.includes('https://civicpulse.example/office'));
  assert.ok(!/password|token|secret/i.test(m));
  assert.equal(strings.office.waitingFor(0), 'Sent to you today, no reply yet');
  assert.equal(strings.office.waitingFor(1), 'Sent to you 1 day ago, no reply yet');
  assert.equal(strings.office.waitingFor(3), 'Sent to you 3 days ago, no reply yet');
});

test('the public report labels a reply written by signed-in office staff', () => {
  assert.ok(strings.replies.viaOffice && strings.replies.viaOffice !== strings.replies.viaLink);
  const src = readFileSync(new URL('../components/OfficeReplies.js', import.meta.url), 'utf8');
  assert.ok(/source === 'office'/.test(src));
});

test('the office page is private and wired up: not indexed, no referrer, no ads, and linked from the moderator desk', () => {
  const layout = readFileSync(new URL('../app/office/layout.js', import.meta.url), 'utf8');
  assert.ok(/index:\s*false/.test(layout) && /referrer:\s*'no-referrer'/.test(layout));
  const admin = readFileSync(new URL('../app/admin/page.js', import.meta.url), 'utf8');
  assert.ok(/AdminOfficeStaff/.test(admin) && /'staff'/.test(admin));
  const page = readFileSync(new URL('../app/office/page.js', import.meta.url), 'utf8');
  assert.ok(/staff_my_offices|loadMyOffices/.test(page) && /signInWithOtp/.test(page));
  assert.ok(!/console\.(log|info|debug)/.test(page + readFileSync(new URL('../components/OfficeIssue.js', import.meta.url), 'utf8')), 'no logging of reports or emails');
  assert.ok(strings.admin.views.staff);
});

test('staff cannot do more than reply: the page never calls a status, photo, hide or link function', () => {
  const files = ['../app/office/page.js', '../components/OfficeIssue.js', '../lib/officeStaff.js'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
  const used = [...files.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(used.length >= 3);
  for (const name of used) assert.ok(name.startsWith('staff_') || name.startsWith('admin_') && /office_staff/.test(name), `unexpected call: ${name}`);
  assert.ok(!/admin_set_status|admin_add_after_photo|admin_hide_office_reply|admin_assign_party/.test(files));
});

test('search boxes are styled like the other fields (type=search was unstyled)', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(/input\[type=search\] \{ font:inherit/.test(css));
});
