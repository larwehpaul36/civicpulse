// Helpers for the spam checks (migration 029). Pure, so they can be tested.

// Which limit did the database say no with? Codes CP001-CP003 are set in 029; the message is the fallback.
export function abuseKey(err) {
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? '');
  if (code === 'CP001' || /report_rate_limited/.test(msg)) return 'rate';
  if (code === 'CP002' || /outside_ghana/.test(msg)) return 'outside';
  if (code === 'CP003' || /flag_rate_limited/.test(msg)) return 'flagRate';
  return null;
}

// Add the review list's answer to each report as spam_score and spam_reasons.
export function mergeSpam(issues, rows) {
  const by = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.issue_id, r]));
  return issues.map((i) => {
    const r = by.get(i.id);
    return r ? { ...i, spam_score: r.score, spam_reasons: r.reasons ?? [] } : { ...i, spam_score: 0, spam_reasons: [] };
  });
}

export const isSuspicious = (i) => (i.spam_reasons?.length ?? 0) > 0 && !['rejected', 'resolved'].includes(i.status);
