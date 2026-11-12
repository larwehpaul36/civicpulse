// Promises kept: an office gives an expected fix date (office_replies, kind 'expected_date'); did the fix come by then?
// Pure functions (no database, no browser), so tests/promises.test.mjs covers the rules.
//
// Rules, chosen so an office cannot look good by moving its own goalposts:
//  - Only the FIRST date an office gave for a report counts. Later dates are counted as "date moved" but never replace it.
//  - Kept   = the report was resolved on or before that date.
//  - Late   = resolved, but after that date.
//  - Overdue = still open and the date has passed.
//  - Pending = still open and the date has not passed yet (not counted for or against anyone).
//  - Rejected reports are ignored.
// Percentages are only shown once an office has at least MIN_DECIDED decided promises, so one case never makes a verdict.
import { fetchAll } from './fetchAll.js';

export const MIN_DECIDED = 5;
const day = (t) => String(t).slice(0, 10); // ISO timestamps and dates are both UTC; Ghana is UTC+0, so no shift is needed

// Date replies, oldest first, for one report. Ties are broken by id so the result never depends on row order.
const byTime = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : String(a.id).localeCompare(String(b.id)));

export function judgePromise(issue, replies, today) {
  const dates = replies.filter((r) => r.kind === 'expected_date' && r.expected_date).sort(byTime);
  if (!dates.length || issue.status === 'rejected') return null;
  const first = dates[0];
  let moved = 0;
  for (let i = 1; i < dates.length; i++) if (dates[i].expected_date !== dates[i - 1].expected_date) moved += 1;
  const promised = day(first.expected_date);
  let outcome;
  if (issue.status === 'resolved' && issue.resolved_at) outcome = day(issue.resolved_at) <= promised ? 'kept' : 'late';
  else outcome = today > promised ? 'overdue' : 'pending';
  return { issueId: issue.id, partyId: first.party_id ?? issue.party_id ?? null, promised, outcome, moved };
}

// rows: public issues. replies: all expected_date replies. today: 'YYYY-MM-DD'.
export function promiseStats(rows, replies, today) {
  const repliesByIssue = new Map();
  for (const r of replies) { const l = repliesByIssue.get(r.issue_id) ?? []; l.push(r); repliesByIssue.set(r.issue_id, l); }
  const by = new Map();
  for (const issue of rows) {
    const j = judgePromise(issue, repliesByIssue.get(issue.id) ?? [], today);
    if (!j || !j.partyId) continue;
    const p = by.get(j.partyId) ?? { id: j.partyId, made: 0, kept: 0, late: 0, overdue: 0, pending: 0, moved: 0 };
    p.made += 1; p[j.outcome] += 1; if (j.moved > 0) p.moved += 1;
    by.set(j.partyId, p);
  }
  return [...by.values()].map((p) => {
    const decided = p.kept + p.late + p.overdue;
    return { ...p, decided, keptPercent: decided >= MIN_DECIDED ? Math.round((p.kept / decided) * 100) : null, early: decided < MIN_DECIDED };
  }).sort((a, b) => b.overdue - a.overdue || b.decided - a.decided || String(a.id).localeCompare(String(b.id)));
}

// Every expected-date reply the public may see. Quietly empty if 021 has not been run.
export async function loadDateReplies(supabase) {
  try {
    return await fetchAll((a, b) => supabase.from('office_replies')
      .select('id, issue_id, party_id, expected_date, created_at, kind').eq('kind', 'expected_date').order('id').range(a, b));
  } catch { return []; }
}
