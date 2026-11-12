// Office right of reply (migration 021). A moderator records what an office told us; the public report page shows it.
// The Supabase client is passed in, so tests run without a network.
export const KINDS = ['reply', 'expected_date', 'not_ours'];
export const MAX_LEN = 500;

// Public replies for one report, oldest first. Any failure (021 not run yet, offline) quietly means "no replies".
export async function loadReplies(supabase, issueId) {
  const { data, error } = await supabase.from('office_replies')
    .select('id, kind, body, expected_date, created_at').eq('issue_id', issueId).order('created_at');
  return error || !Array.isArray(data) ? [] : data;
}

// The newest expected date is the one that counts.
export function latestExpectedDate(replies) {
  const dates = replies.filter((r) => r.kind === 'expected_date' && r.expected_date).map((r) => r.expected_date).sort();
  return dates.at(-1) ?? null;
}

// "YYYY-MM-DD" strings compare correctly as text. `today` is passed in so tests do not depend on the clock.
export function isOverdue(expected, status, today) {
  return !!expected && status !== 'resolved' && status !== 'rejected' && expected < today;
}

// Same rules as the database, so the form can explain a problem before sending. Returns an error key or null.
export function checkReply({ kind, body, expected }, today) {
  if (!KINDS.includes(kind)) return 'bad_kind';
  const text = (body ?? '').trim();
  if (text.length > MAX_LEN) return 'too_long';
  if (kind === 'expected_date') {
    if (!expected) return 'date_required';
    const limit = new Date(`${today}T00:00:00Z`); limit.setUTCDate(limit.getUTCDate() + 365);
    if (expected < today || expected > limit.toISOString().slice(0, 10)) return 'bad_date';
  } else if (!text) return 'text_required';
  return null;
}

const KNOWN = ['bad_kind', 'issue_not_found', 'no_party', 'text_required', 'too_long', 'date_required', 'bad_date', 'not_moderator'];
export const errorKey = (e) => {
  const text = `${e?.message ?? ''} ${e?.details ?? ''}`;
  return KNOWN.find((k) => text.includes(k)) ?? 'failed';
};

export async function addReply(supabase, issueId, { kind, body, expected }, today) {
  const bad = checkReply({ kind, body, expected }, today);
  if (bad) return { error: bad };
  const { error } = await supabase.rpc('admin_add_office_reply', {
    p_issue: issueId, p_kind: kind, p_body: (body ?? '').trim() || null, p_expected: kind === 'expected_date' ? expected : null,
  });
  return error ? { error: errorKey(error) } : { ok: true };
}

export async function hideReply(supabase, replyId) {
  const { error } = await supabase.rpc('admin_hide_office_reply', { p_reply: replyId });
  return error ? { error: errorKey(error) } : { ok: true };
}

export async function loadAdminReplies(supabase, issueId) {
  const { data, error } = await supabase.rpc('admin_list_office_replies', { p_issue: issueId });
  return error || !Array.isArray(data) ? [] : data;
}
