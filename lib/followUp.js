// Reminders and escalation prompts. Nothing is sent automatically: this only decides which open reports are "due"
// for a nudge, so the moderator sees a short list instead of hunting. The numbers below are the rules.
export const RULES = {
  remindAfter: 7,            // days since the report was sent to the office with no reply at all
  escalateAfter: 30,         // days with no reply at all: go above the office
  staleAfter: 30,            // the office did reply once, but nothing for this long and no promised date
  lateEscalateAfter: 21,     // days past a promised fix date before we escalate
  remindCooldown: 7,         // after a reminder, leave it this long
  escalateCooldown: 14,      // after an escalation, leave it this long
};

const DAY = 86400000;
const ms = (v) => { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : NaN; };
const daysSince = (v, now) => { const t = ms(v); return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY)) : null; };
// A promised date counts as missed from the day AFTER it (the office has the whole day to deliver).
const daysLate = (date, now) => {
  if (!date) return 0;
  const t = ms(`${String(date).slice(0, 10)}T23:59:59Z`);
  return Number.isFinite(t) && now > t ? Math.max(1, Math.floor((now - t) / DAY) + 1) : 0;
};

export const STAGE_RANK = { escalate: 0, promise_missed: 1, remind: 2, stale: 3 };

// -> null when nothing is due, else { stage, days, late }
//    stage: 'escalate' | 'promise_missed' | 'remind' | 'stale'
export function followUpStage(row, now = Date.now(), rules = RULES) {
  if (!row || (row.status !== 'sent' && row.status !== 'in_progress') || !row.party_id) return null;
  const days = daysSince(row.sent_at ?? row.created_at, now);
  if (days === null) return null;
  const late = daysLate(row.expected_date, now);
  const replies = row.replies_count ?? 0;
  const sinceReminder = row.last_reminder_at ? daysSince(row.last_reminder_at, now) : null;
  const sinceEscalation = row.last_escalation_at ? daysSince(row.last_escalation_at, now) : null;
  const coolReminder = sinceReminder !== null && sinceReminder < rules.remindCooldown;
  const coolEscalation = sinceEscalation !== null && sinceEscalation < rules.escalateCooldown;

  let stage = null;
  if (late >= rules.lateEscalateAfter || (replies === 0 && days >= rules.escalateAfter)) stage = 'escalate';
  else if (late > 0) stage = 'promise_missed';
  else if (replies === 0 && days >= rules.remindAfter) stage = 'remind';
  else if (replies > 0 && !row.expected_date && daysSince(row.last_reply_at, now) >= rules.staleAfter) stage = 'stale';
  if (!stage) return null;
  if (stage === 'escalate' ? coolEscalation : coolReminder) return null;
  return { stage, days, late };
}

// The follow-up list: only reports that are due, most serious first, then the longest waiting.
export function followUpList(rows, now = Date.now(), rules = RULES) {
  return (rows ?? [])
    .map((row) => ({ row, due: followUpStage(row, now, rules) }))
    .filter((x) => x.due)
    .sort((a, b) => STAGE_RANK[a.due.stage] - STAGE_RANK[b.due.stage] || b.due.days - a.due.days);
}

// What gets written to the private contact log when the moderator says "I sent it".
export const logNote = (kind, target) => (kind === 'escalate' ? `Escalated${target ? ` to ${String(target).slice(0, 120)}` : ''}` : 'Reminder sent');
