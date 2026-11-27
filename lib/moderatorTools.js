// Pure helpers for the moderator tools (bulk actions and the activity record). No database calls here, so they can be tested.
export const BULK_MAX = 50;                                  // same limit as the database functions in 028
export const BULK_STATUSES = ['verified', 'sent', 'in_progress', 'rejected'];   // "resolved" needs a photo, so it stays a one-by-one job
export const NEEDS_CONFIRM = new Set(['rejected', 'sent', 'assign', 'dismiss']);  // actions a moderator should confirm before they run

// Add or remove one id. Never goes past the limit (the caller is told when it was refused).
export function toggleId(ids, id) {
  if (ids.includes(id)) return { ids: ids.filter((x) => x !== id), full: false };
  if (ids.length >= BULK_MAX) return { ids, full: true };
  return { ids: [...ids, id], full: false };
}

// "Select all" takes the first BULK_MAX of what is on screen.
export function selectShown(shown) {
  const all = shown.map((x) => x.id);
  return { ids: all.slice(0, BULK_MAX), cut: Math.max(0, all.length - BULK_MAX) };
}

// Keep only the ids that are still on screen (after a refresh or a tab change).
export const keepVisible = (ids, shown) => { const on = new Set(shown.map((x) => x.id)); return ids.filter((id) => on.has(id)); };

// The database answers one row per report: { issue_id, ok, error }.
export function summarize(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const failed = list.filter((r) => !r.ok).map((r) => ({ id: r.issue_id, error: String(r.error ?? '') }));
  return { total: list.length, done: list.length - failed.length, failed };
}

export function failureKey(error) {
  const e = String(error ?? '');
  if (/after_photo_required/.test(e)) return 'after_photo_required';
  if (/party_required/.test(e)) return 'party_required';
  if (/not_found/.test(e)) return 'not_found';
  return 'other';
}

// Count how many of each failure, e.g. { party_required: 3, other: 1 }.
export function failureCounts(failed) {
  const out = {};
  for (const f of failed) { const k = failureKey(f.error); out[k] = (out[k] ?? 0) + 1; }
  return out;
}

export function bulkErrorKey(error) {
  const e = String(error?.message ?? error ?? '');
  if (/nothing_selected/.test(e)) return 'nothing';
  if (/too_many/.test(e)) return 'tooMany';
  if (/party_not_found/.test(e)) return 'noOffice';
  if (/not_moderator|42501/.test(e)) return 'notModerator';
  return 'other';
}

// Group the record by bulk batch so "Rejected 12 reports" reads as one line, not twelve.
export function groupActivity(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const batch = r.detail?.batch;
    const last = out[out.length - 1];
    if (batch && last && last.batch === batch && last.action === r.action && last.moderator_id === r.moderator_id
        && (r.action !== 'status' || last.detail?.to === r.detail?.to)) {
      last.items.push(r); last.count += 1;
    } else {
      out.push({ ...r, batch: batch ?? null, items: [r], count: 1 });
    }
  }
  return out;
}

// One plain sentence for a row of the record. `T` is strings.admin.activity; names are id -> name maps.
export function describeActivity(row, T, names = {}) {
  const d = row.detail ?? {};
  const n = row.count ?? 1;
  const party = (id) => names.parties?.[id] ?? T.unknownOffice;
  switch (row.action) {
    case 'status': return T.status(n, T.statusWord[d.to] ?? d.to);
    case 'assign_office': return T.assign(n, party(d.to));
    case 'category': return T.category(n, names.categories?.[d.to] ?? '');
    case 'dismiss_flags': return T.dismiss(n);
    case 'hide_reply': return T.hideReply(n);
    case 'invite_staff': return T.invite(d.email ?? '', party(d.party));
    case 'revoke_staff': return T.revoke(d.email ?? '', party(d.party));
    default: return T.other(row.action);
  }
}
