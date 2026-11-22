// One-tap reply links for offices (migration 025). The Supabase client is passed in, so tests run without a network.
// A link carries a 64-character secret. The page asks the database whether it is good; the database says nothing more
// than "link_invalid" for a wrong, expired or revoked one.
import { checkReply } from './officeReplies.js';

export const isToken = (t) => typeof t === 'string' && /^[0-9a-f]{64}$/.test(t);
export const linkUrl = (origin, token) => `${String(origin).replace(/\/+$/, '')}/reply/${token}`;

const KNOWN = ['link_invalid', 'rate_limited', 'bad_kind', 'text_required', 'too_long', 'date_required', 'bad_date', 'not_moderator', 'no_party', 'issue_not_found'];
export const linkErrorKey = (e) => {
  const text = `${e?.message ?? ''} ${e?.details ?? ''}`;
  return KNOWN.find((k) => text.includes(k)) ?? 'failed';
};

// For the office page: what the link is for. Returns { info } or { error }.
export async function loadLinkInfo(supabase, token) {
  if (!isToken(token)) return { error: 'link_invalid' };   // do not even ask the database about junk
  const { data, error } = await supabase.rpc('office_link_info', { p_token: token });
  if (error) return { error: 'failed' };
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { info: row } : { error: 'link_invalid' };
}

// For the office page: send the reply. The same checks as the database, so the page can explain a problem first.
export async function replyViaLink(supabase, token, { kind, body, expected }, today) {
  if (!isToken(token)) return { error: 'link_invalid' };
  const bad = checkReply({ kind, body, expected }, today);
  if (bad) return { error: bad };
  const { error } = await supabase.rpc('office_reply_via_link', {
    p_token: token, p_kind: kind, p_body: (body ?? '').trim() || null, p_expected: kind === 'expected_date' ? expected : null,
  });
  return error ? { error: linkErrorKey(error) } : { ok: true };
}

// For the moderator: make a link for a report. Returns { token } or { error }. Never throws, so a missing migration only means "no link".
export async function makeReplyLink(supabase, issueId, days = 30) {
  try {
    const { data, error } = await supabase.rpc('admin_make_reply_link', { p_issue: issueId, p_days: days });
    if (error) return { error: linkErrorKey(error) };
    return isToken(data) ? { token: data } : { error: 'failed' };
  } catch { return { error: 'failed' }; }
}

export async function revokeReplyLinks(supabase, issueId) {
  try {
    const { data, error } = await supabase.rpc('admin_revoke_reply_links', { p_issue: issueId });
    return error ? { error: linkErrorKey(error) } : { count: Number(data) || 0 };
  } catch { return { error: 'failed' }; }
}
