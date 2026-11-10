// Moderator view of "Is it fixed?" (020). Pure helpers so they can be tested without a database.
// rows come from admin_fix_check_summary(): { issue_id, reopen_count, fixed, partly, not_fixed } for the current round.
export function mergeFixChecks(issues, rows) {
  const by = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.issue_id, r]));
  return issues.map((i) => {
    const r = by.get(i.id);
    return { ...i, reopen_count: r?.reopen_count ?? 0, fix_fixed: r?.fixed ?? 0, fix_partly: r?.partly ?? 0, fix_not: r?.not_fixed ?? 0 };
  });
}

// Worth a moderator's attention: neighbours disputed it this round, or it has been reopened before.
export const isDisputed = (i) => i.status !== 'rejected' && ((i.fix_partly ?? 0) + (i.fix_not ?? 0) > 0 || (i.reopen_count ?? 0) > 0);
