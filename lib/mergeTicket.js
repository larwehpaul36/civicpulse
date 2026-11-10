// Brings the reports of an anonymous phone along when its owner signs in to an account that already exists (migration 017).
//
// Before the sign-in link is sent, this phone (still anonymous) asks the database for a one-time ticket and keeps it here,
// together with the email address the link goes to. After the link is opened and the person is signed in, the ticket is
// handed over and the reports move. The ticket is used only if the account signed in to has the SAME email address, so a
// ticket left behind on a shared phone can never move reports into somebody else's account.
const KEY = 'civicpulse.mergeTicket';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // matches the database: a ticket works for 24 hours

// localStorage can be missing or throw (private windows, blocked site data); then merging simply does not happen.
export const browserStorage = () => {
  try {
    const ls = window.localStorage;
    return { getItem: (k) => ls.getItem(k), setItem: (k, v) => ls.setItem(k, v), removeItem: (k) => ls.removeItem(k) };
  } catch { return null; }
};

const read = (storage) => {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) ?? 'null');
    return saved && typeof saved.ticket === 'string' && typeof saved.email === 'string' && Number.isFinite(saved.at) ? saved : null;
  } catch { return null; }
};
const forget = (storage) => { try { storage?.removeItem(KEY); } catch { /* nothing to do */ } };
const has = (error, ...words) => words.some((w) => String(error?.message ?? error?.details ?? '').includes(w));

// Step 1. Returns 'ready' (ticket kept), or 'nothing' (this phone has no anonymous account, so there is nothing to bring).
// Throws Error('prepare_failed') when the ticket could not be made or kept: the caller decides whether to go on without it.
export async function prepareMerge({ supabase, storage = browserStorage(), now = Date.now() }, email) {
  const { data, error } = await supabase.rpc('create_merge_ticket');
  if (error) {
    if (has(error, 'not_anonymous', 'not_signed_in')) { forget(storage); return 'nothing'; }
    throw Object.assign(new Error('prepare_failed'), { cause: error });
  }
  try {
    if (!storage || typeof data !== 'string' || !data) throw new Error('no ticket');
    storage.setItem(KEY, JSON.stringify({ ticket: data, email: String(email).trim().toLowerCase(), at: now }));
  } catch (cause) { throw Object.assign(new Error('prepare_failed'), { cause }); }
  return 'ready';
}

// Step 2, whenever a signed-in account (with a confirmed email) is on screen. Returns { moved } when it worked, else null.
// A ticket that can never work is thrown away; one that merely could not be tried yet (offline) is kept for next time.
export async function claimPending({ supabase, storage = browserStorage(), now = Date.now() }, signedInEmail) {
  const saved = read(storage);
  if (!saved) return null;
  if (now - saved.at > MAX_AGE_MS) { forget(storage); return null; }
  if (String(signedInEmail ?? '').trim().toLowerCase() !== saved.email) return null; // not the account this ticket was made for
  const { data, error } = await supabase.rpc('claim_merge_ticket', { p_ticket: saved.ticket });
  if (error) {
    if (has(error, 'ticket_invalid')) forget(storage);
    return null;
  }
  forget(storage);
  return { moved: Number(data?.moved) || 0 };
}
