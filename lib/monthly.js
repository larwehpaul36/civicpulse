// The monthly accountability report: pure functions over the same public rows the tracker uses (no database, no browser).
// Months are calendar months in UTC (Ghana is on UTC+0). Honest limits: a report that was resolved and then reopened has no
// resolved date any more, so it is not counted as resolved in the month it was first resolved; and "reopened" is a running
// total, because the database keeps no date for it.
import { median } from './trackerStats.js';

const DAY = 86400000;
const ms = (x) => Date.parse(x);
const days = (a, b) => Math.max(0, Math.floor((b - a) / DAY));

export const monthRange = (year, month) => ({ start: Date.UTC(year, month, 1), end: Date.UTC(year, month + 1, 1) });
export const lastFullMonth = (now) => { const d = new Date(now); return d.getUTCMonth() === 0 ? { year: d.getUTCFullYear() - 1, month: 11 } : { year: d.getUTCFullYear(), month: d.getUTCMonth() - 1 }; };
export const shiftMonth = ({ year, month }, by) => { const d = new Date(Date.UTC(year, month + by, 1)); return { year: d.getUTCFullYear(), month: d.getUTCMonth() }; };

const inRange = (t, r) => t != null && t >= r.start && t < r.end;
const MIN_FIXES = 3; // fewer than this is too little to call anyone "improved"

export function monthlyReport(rows, { year, month }) {
  const range = monthRange(year, month);
  const before = { start: monthRange(...Object.values(shiftMonth({ year, month }, -3))).start, end: range.start }; // the 3 months before
  const t = rows.map((r) => ({ ...r, c: r.created_at ? ms(r.created_at) : null, s: r.sent_at ? ms(r.sent_at) : null, r: r.resolved_at && r.status === 'resolved' ? ms(r.resolved_at) : null }));

  const headline = {
    filed: t.filter((r) => inRange(r.c, range)).length,
    sent: t.filter((r) => inRange(r.s, range)).length,
    resolved: t.filter((r) => r.s != null && inRange(r.r, range)).length,
  };
  headline.medianDays = median(t.filter((r) => r.s != null && inRange(r.r, range)).map((r) => days(r.s, r.r)));

  const by = new Map();
  for (const r of t) {
    if (!r.party_id || r.s == null || r.s >= range.end) continue; // only cases already sent to an office by month end
    const o = by.get(r.party_id) ?? { id: r.party_id, sentThisMonth: 0, fixedThisMonth: [], fixedBefore: [], openAtEnd: 0, oldestOpenAtEnd: null, reopened: 0 };
    if (inRange(r.s, range)) o.sentThisMonth += 1;
    if (r.r != null && inRange(r.r, range)) o.fixedThisMonth.push(days(r.s, r.r));
    if (r.r != null && inRange(r.r, before)) o.fixedBefore.push(days(r.s, r.r));
    if (r.r == null || r.r >= range.end) { o.openAtEnd += 1; o.oldestOpenAtEnd = Math.max(o.oldestOpenAtEnd ?? 0, days(r.s, range.end)); }
    o.reopened += Number(r.reopen_count) || 0;
    by.set(r.party_id, o);
  }
  const offices = [...by.values()].map((o) => ({
    id: o.id, sentThisMonth: o.sentThisMonth, fixed: o.fixedThisMonth.length, medianDays: median(o.fixedThisMonth),
    medianBefore: median(o.fixedBefore), fixedBefore: o.fixedBefore.length,
    openAtEnd: o.openAtEnd, oldestOpenAtEnd: o.oldestOpenAtEnd, reopened: o.reopened,
  }));

  // Slowest to respond: the offices whose oldest case had waited longest at month end (by days, then by backlog).
  const slowest = offices.filter((o) => o.openAtEnd > 0).sort((a, b) => b.oldestOpenAtEnd - a.oldestOpenAtEnd || b.openAtEnd - a.openAtEnd).slice(0, 5);
  // Most improved: faster than their own previous 3 months, with enough fixes in both periods to mean something.
  const improved = offices
    .filter((o) => o.fixed >= MIN_FIXES && o.fixedBefore >= MIN_FIXES && o.medianDays < o.medianBefore)
    .map((o) => ({ ...o, fasterBy: o.medianBefore - o.medianDays }))
    .sort((a, b) => b.fasterBy - a.fasterBy).slice(0, 5);
  // Most fixes: simple credit where it is due.
  const mostFixes = offices.filter((o) => o.fixed > 0).sort((a, b) => b.fixed - a.fixed || (a.medianDays ?? 1e9) - (b.medianDays ?? 1e9)).slice(0, 5);

  return { range, headline, slowest, improved, mostFixes, officeCount: offices.length, minFixes: MIN_FIXES };
}
