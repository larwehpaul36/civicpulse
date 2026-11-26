import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { followUpList, followUpStage, logNote, RULES } from '../lib/followUp.js';
import { strings } from '../lib/strings.js';

const now = Date.parse('2026-11-25T12:00:00Z');
const ago = (d) => new Date(now - d * 86400000).toISOString();
const row = (o = {}) => ({ id: 'i', status: 'sent', party_id: 'p', sent_at: ago(1), created_at: ago(60), replies_count: 0, last_reply_at: null, expected_date: null, last_reminder_at: null, last_escalation_at: null, reminders_count: 0, ...o });
const stage = (o) => followUpStage(row(o), now)?.stage ?? null;

test('no reply: nothing at first, a reminder at 7 days, going above the office at 30', () => {
  assert.equal(stage({ sent_at: ago(1) }), null);
  assert.equal(stage({ sent_at: ago(6) }), null);
  assert.equal(stage({ sent_at: ago(7) }), 'remind');
  assert.equal(stage({ sent_at: ago(29) }), 'remind');
  assert.equal(stage({ sent_at: ago(30) }), 'escalate');
  assert.equal(stage({ sent_at: ago(200) }), 'escalate');
});

test('the clock starts when the report was SENT to the office, not when it was reported', () => {
  assert.equal(stage({ sent_at: ago(2), created_at: ago(300) }), null);
  assert.equal(stage({ sent_at: null, created_at: ago(10) }), 'remind', 'no sent date: fall back to the report date');
});

test('a reminder rests for 7 days, an escalation for 14', () => {
  assert.equal(stage({ sent_at: ago(15), last_reminder_at: ago(3) }), null);
  assert.equal(stage({ sent_at: ago(15), last_reminder_at: ago(7) }), 'remind');
  assert.equal(stage({ sent_at: ago(40), last_reminder_at: ago(2) }), 'escalate', 'a reminder does not hide the need to escalate');
  assert.equal(stage({ sent_at: ago(40), last_escalation_at: ago(5) }), null);
  assert.equal(stage({ sent_at: ago(40), last_escalation_at: ago(14) }), 'escalate');
});

test('a promised date that passes is a missed promise; three weeks late goes above the office', () => {
  assert.equal(stage({ replies_count: 1, expected_date: '2026-11-26', last_reply_at: ago(2) }), null);
  assert.equal(stage({ replies_count: 1, expected_date: '2026-11-25', last_reply_at: ago(2) }), null, 'the promised day itself is still on time');
  assert.equal(stage({ replies_count: 1, expected_date: '2026-11-24', last_reply_at: ago(2) }), 'promise_missed');
  assert.equal(followUpStage(row({ replies_count: 1, expected_date: '2026-11-20' }), now).late, 5);
  assert.equal(stage({ replies_count: 1, expected_date: '2026-11-04' }), 'escalate');
  assert.equal(stage({ replies_count: 1, expected_date: '2026-11-04', last_escalation_at: ago(3) }), null);
  assert.equal(stage({ replies_count: 1, expected_date: '2026-11-20', last_reminder_at: ago(2) }), null);
});

test('an office that replied is left alone, unless it goes quiet with no date', () => {
  assert.equal(stage({ sent_at: ago(50), replies_count: 1, last_reply_at: ago(5) }), null);
  assert.equal(stage({ sent_at: ago(90), replies_count: 2, last_reply_at: ago(29) }), null);
  assert.equal(stage({ sent_at: ago(90), replies_count: 2, last_reply_at: ago(30) }), 'stale');
  assert.equal(stage({ sent_at: ago(90), replies_count: 2, last_reply_at: ago(60), expected_date: '2026-12-20' }), null, 'a future promise is respected');
});

test('only open reports that have an office are ever due', () => {
  for (const status of ['resolved', 'rejected', 'reported', 'verified', undefined]) assert.equal(stage({ status, sent_at: ago(90) }), null, String(status));
  assert.equal(stage({ party_id: null, sent_at: ago(90) }), null);
  assert.equal(stage({ status: 'in_progress', sent_at: ago(10) }), 'remind');
  assert.equal(followUpStage(null, now), null);
  assert.equal(followUpStage(row({ sent_at: 'garbage', created_at: 'garbage' }), now), null);
});

test('the list shows what is due, most serious first, then longest waiting', () => {
  const rows = [
    row({ id: 'remind-old', sent_at: ago(25) }), row({ id: 'remind-new', sent_at: ago(8) }), row({ id: 'fine', sent_at: ago(2) }),
    row({ id: 'esc', sent_at: ago(45) }), row({ id: 'missed', replies_count: 1, expected_date: '2026-11-20', sent_at: ago(10) }),
    row({ id: 'stale', replies_count: 1, last_reply_at: ago(40), sent_at: ago(80) }), row({ id: 'done', status: 'resolved', sent_at: ago(90) }),
  ];
  assert.deepEqual(followUpList(rows, now).map((x) => x.row.id), ['esc', 'missed', 'remind-old', 'remind-new', 'stale']);
  assert.deepEqual(followUpList(null, now), []);
  assert.deepEqual(RULES, { remindAfter: 7, escalateAfter: 30, staleAfter: 30, lateEscalateAfter: 21, remindCooldown: 7, escalateCooldown: 14 });
});

test('the contact log notes match what the database function looks for', () => {
  assert.equal(logNote('remind'), 'Reminder sent');
  assert.equal(logNote('escalate'), 'Escalated');
  assert.equal(logNote('escalate', 'Ashanti Regional Coordinating Council'), 'Escalated to Ashanti Regional Coordinating Council');
  assert.ok(logNote('escalate', 'x'.repeat(500)).length < 140);
  const sql = readFileSync(new URL('../027_followup_queue.sql', import.meta.url), 'utf8');
  assert.ok(sql.includes("c.note = 'Reminder sent'") && sql.includes("c.note like 'Escalated%'"));
});

test('messages say only what is true and leave out lines that are empty', () => {
  const F = strings.admin.followUp;
  const base = { party: 'Ga East Assembly', category: 'Pothole', description: 'Big hole', days: 12, late: 0, expected: '', replies: 0, quiet: 12, reminders: 0, confirmations: 3, mapUrl: 'https://maps/x', reportUrl: 'https://c/issues/1', replyUrl: '', target: '' };
  const m1 = F.reminderMessage(base);
  assert.ok(m1.includes('12 days ago and we have not had a reply') && m1.includes('Please reply with when it will be fixed.'));
  const m2 = F.reminderMessage({ ...base, replyUrl: 'https://c/reply/abc', mapUrl: null, description: '', confirmations: 0 });
  assert.ok(m2.includes('Reply in one tap, no sign-in needed: https://c/reply/abc') && !/Location:|Details:|Confirmed by|null|undefined/.test(m2));
  const m3 = F.reminderMessage({ ...base, late: 4, expected: '20 Nov 2026' });
  assert.ok(m3.includes('gave 20 Nov 2026 as the expected fix date') && !m3.includes('have not had a reply'));
  const e1 = F.escalateMessage(base);
  assert.ok(e1.startsWith('Hello Sir or Madam,') && e1.includes('no reply.') && !e1.includes('even after'));
  const e2 = F.escalateMessage({ ...base, target: 'Ashanti RCC', reminders: 2 });
  assert.ok(e2.startsWith('Hello Ashanti RCC,') && e2.includes('even after 2 reminders'));
  assert.ok(F.escalateMessage({ ...base, reminders: 1 }).includes('even after 1 reminder.'));
  assert.ok(F.escalateMessage({ ...base, replies: 1, quiet: 40 }).includes('no progress for 40 days'));
  assert.ok(F.escalateMessage({ ...base, late: 22, expected: '1 Nov 2026' }).includes('passed 22 days ago'));
  for (const m of [m1, m2, m3, e1, e2]) assert.ok(!/undefined|NaN|\[object/.test(m));
  assert.equal(F.why.remind({ days: 9 }), 'Sent to the office 9 days ago and they have not replied.');
  assert.ok(F.why.escalate({ days: 40, reminders: 1, late: 0 }).includes('after 1 reminder'));
});

test('the follow-up tab is wired in and the admin page survives a missing migration', () => {
  const page = readFileSync(new URL('../app/admin/page.js', import.meta.url), 'utf8');
  assert.ok(/admin_followup_queue/.test(page) && /'followup'/.test(page) && /AdminFollowUp/.test(page));
  assert.ok(/Array\.isArray\(fq\.data\)/.test(page), 'an error from the function must not break the desk');
  assert.ok(strings.admin.views.followup);
  const comp = readFileSync(new URL('../components/AdminFollowUp.js', import.meta.url), 'utf8');
  assert.ok(!/setInterval|setTimeout|useEffect/.test(comp), 'nothing is sent or recorded by itself: only buttons do it');
  assert.ok(/admin_log_contact/.test(comp));
});
