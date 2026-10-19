// Numbers for the public tracker. Pure functions: no database, no browser. Rows come from the public_issues view.
const DAY = 86400000, WEEK = 7 * DAY;
const ms = (x) => Date.parse(x);

export const isFixed = (r) => r.status === 'resolved' && !!r.resolved_at && !!r.sent_at;
export const fixDays = (r) => Math.max(0, Math.floor((ms(r.resolved_at) - ms(r.sent_at)) / DAY));

export function median(nums) {
  if (!nums.length) return null;
  const b = [...nums].sort((x, y) => x - y), m = Math.floor(b.length / 2);
  return b.length % 2 ? b[m] : Math.round((b[m - 1] + b[m]) / 2);
}

// Monday 00:00 UTC of the week containing the given moment.
export const weekStart = (t) => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
};

// Headline numbers for a set of reports.
export function summarize(rows) {
  const sent = rows.filter((r) => r.sent_at);
  const fixed = sent.filter(isFixed);
  return { filed: rows.length, sent: sent.length, resolved: fixed.length, open: sent.length - fixed.length, median: median(fixed.map(fixDays)) };
}

// How many of these dates fall in each of the last N weeks (oldest first).
export function weeklyCounts(dates, now, weeks) {
  const this_ = weekStart(now), out = Array(weeks).fill(0);
  for (const d of dates) {
    const i = weeks - 1 - Math.floor((this_ - weekStart(ms(d))) / WEEK);
    if (i >= 0 && i < weeks && ms(d) <= now) out[i] += 1;
  }
  return out;
}

export function weeklyTrend(rows, now, weeks = 12) {
  const filed = weeklyCounts(rows.map((r) => r.created_at).filter(Boolean), now, weeks);
  const resolved = weeklyCounts(rows.filter(isFixed).map((r) => r.resolved_at), now, weeks);
  const this_ = weekStart(now);
  return filed.map((f, i) => ({ start: this_ - (weeks - 1 - i) * WEEK, filed: f, resolved: resolved[i] }));
}

// One entry per responsible party, counting only cases that were actually sent to them.
export function partyStats(rows, now) {
  const by = new Map();
  for (const r of rows) {
    if (!r.party_id || !r.sent_at) continue;
    const p = by.get(r.party_id) ?? { id: r.party_id, sent: 0, resolved: 0, open: 0, fix: [], resolvedAt: [], oldestOpen: null };
    p.sent += 1;
    if (isFixed(r)) { p.resolved += 1; p.fix.push(fixDays(r)); p.resolvedAt.push(r.resolved_at); }
    else { p.open += 1; p.oldestOpen = Math.max(p.oldestOpen ?? 0, Math.max(0, Math.floor((now - ms(r.sent_at)) / DAY))); }
    by.set(r.party_id, p);
  }
  return [...by.values()].map((p) => ({
    id: p.id, sent: p.sent, resolved: p.resolved, open: p.open, oldestOpen: p.oldestOpen,
    median: median(p.fix), rate: Math.round((100 * p.resolved) / p.sent),
    early: p.sent < 3, // too few cases to judge fairly
    spark: weeklyCounts(p.resolvedAt, now, 8),
  }));
}

export function sortParties(list, mode) {
  const L = [...list];
  if (mode === 'backlog') return L.sort((a, b) => b.open - a.open || b.sent - a.sent);
  if (mode === 'oldest') return L.sort((a, b) => (b.oldestOpen ?? -1) - (a.oldestOpen ?? -1));
  return L.sort((a, b) => { // fastest: offices with fixes first, by median; offices with none last, biggest backlog first
    if (a.median === null && b.median === null) return b.open - a.open;
    if (a.median === null) return 1;
    if (b.median === null) return -1;
    return a.median - b.median || b.sent - a.sent;
  });
}
