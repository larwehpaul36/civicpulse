// Office staff accounts (migration 026). A moderator invites an assembly's staff by email; staff sign in at /office,
// see only the reports sent to their office, and reply in public. The Supabase client is passed in, so tests run without a network.
import { checkReply } from './officeReplies.js';

export const normEmail = (v) => String(v ?? '').trim().toLowerCase();
export const validEmail = (v) => {
  const e = normEmail(v);
  return e.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
};

const KNOWN = ['bad_email', 'party_not_found', 'too_many', 'not_moderator', 'issue_not_found', 'not_open', 'rate_limited',
  'bad_kind', 'text_required', 'too_long', 'date_required', 'bad_date'];
export const staffErrorKey = (e) => {
  const text = `${e?.message ?? ''} ${e?.details ?? ''}`;
  return KNOWN.find((k) => text.includes(k)) ?? 'failed';
};

// ---- the office page ----

// The offices this signed-in person works for. `{error}` when 026 has not been run or the network failed (the page says so);
// an empty list means "this email has not been invited".
export async function loadMyOffices(supabase) {
  const { data, error } = await supabase.rpc('staff_my_offices');
  if (error) return { error: 'failed' };
  return { offices: Array.isArray(data) ? data : [] };
}

export async function loadOfficeIssues(supabase) {
  const { data, error } = await supabase.rpc('staff_list_issues');
  if (error) return { error: 'failed' };
  return { issues: Array.isArray(data) ? data : [] };
}

export async function addStaffReply(supabase, issueId, { kind, body, expected }, today) {
  const bad = checkReply({ kind, body, expected }, today);
  if (bad) return { error: bad };
  const { error } = await supabase.rpc('staff_add_reply', {
    p_issue: issueId, p_kind: kind, p_body: (body ?? '').trim() || null, p_expected: kind === 'expected_date' ? expected : null,
  });
  return error ? { error: staffErrorKey(error) } : { ok: true };
}

// A report is "open" for the office while it is with them (sent or in progress). Only open reports take replies.
export const isOpen = (i) => i.status === 'sent' || i.status === 'in_progress';
export const needsReply = (i) => isOpen(i) && !(i.replies_count > 0);

// Which tab a report belongs to on the office page.
export const OFFICE_VIEWS = {
  waiting: needsReply,
  replied: (i) => isOpen(i) && i.replies_count > 0,
  fixed: (i) => i.status === 'resolved',
};

// Waiting reports first, oldest first (they have waited longest); everything else newest first.
export function sortForOffice(list) {
  const since = (i) => new Date(i.sent_at ?? i.created_at).getTime();
  return [...list].sort((a, b) => since(a) - since(b));
}

// Days since the report was sent to the office (not since it was first reported).
export function daysWaiting(i, now = Date.now()) {
  const t = new Date(i.sent_at ?? i.created_at).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86400000)) : 0;
}

// ---- the moderator side ----

export async function listStaff(supabase) {
  const { data, error } = await supabase.rpc('admin_list_office_staff');
  return error ? { error: 'failed' } : { staff: Array.isArray(data) ? data : [] };
}

export async function inviteStaff(supabase, email, partyId) {
  if (!validEmail(email)) return { error: 'bad_email' };
  if (!partyId) return { error: 'party_not_found' };
  const { error } = await supabase.rpc('admin_invite_office_staff', { p_email: normEmail(email), p_party: partyId });
  return error ? { error: staffErrorKey(error) } : { ok: true };
}

export async function revokeStaff(supabase, id) {
  const { error } = await supabase.rpc('admin_revoke_office_staff', { p_id: id });
  return error ? { error: staffErrorKey(error) } : { ok: true };
}
