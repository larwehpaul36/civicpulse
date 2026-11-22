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

// A ticket is made for ONE way of signing in: an email address (the link was sent there) or a phone number (the code was sent
// there). Older tickets saved before phone numbers were supported have only an email, and still work.
const clean = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, '');
const identity = (who) => {
  const w = typeof who === 'string' ? { email: who } : (who ?? {});
  return { email: clean(w.email), phone: clean(w.phone) };
};
const read = (storage) => {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) ?? 'null');
    if (!saved || typeof saved.ticket !== 'string' || !Number.isFinite(saved.at)) return null;
    const email = typeof saved.email === 'string' ? saved.email : '';
    const phone = typeof saved.phone === 'string' ? saved.phone : '';
    return email || phone ? { ticket: saved.ticket, email, phone, at: saved.at } : null;
  } catch { return null; }
};
const forget = (storage) => { try { storage?.removeItem(KEY); } catch { /* nothing to do */ } };
const has = (error, ...words) => words.some((w) => String(error?.message ?? error?.details ?? '').includes(w));

// Step 1. Returns 'ready' (ticket kept), or 'nothing' (this phone has no anonymous account, so there is nothing to bring).
// Throws Error('prepare_failed') when the ticket could not be made or kept: the caller decides whether to go on without it.
// `who` is an email address (string), or { email } or { phone }.
export async function prepareMerge({ supabase, storage = browserStorage(), now = Date.now() }, who) {
  const { data, error } = await supabase.rpc('create_merge_ticket');
  if (error) {
    if (has(error, 'not_anonymous', 'not_signed_in')) { forget(storage); return 'nothing'; }
    throw Object.assign(new Error('prepare_failed'), { cause: error });
  }
  try {
    if (!storage || typeof data !== 'string' || !data) throw new Error('no ticket');
    const id = identity(who);
    if (!id.email && !id.phone) throw new Error('no address');
    storage.setItem(KEY, JSON.stringify(id.phone && !id.email ? { ticket: data, phone: id.phone, at: now } : { ticket: data, email: id.email, at: now }));
  } catch (cause) { throw Object.assign(new Error('prepare_failed'), { cause }); }
  return 'ready';
}

// Step 2, whenever a signed-in account (with a confirmed email or phone) is on screen. Returns { moved } when it worked, else null.
// `signedIn` is the account's email (string), or { email } / { phone }.
// A ticket that can never work is thrown away; one that merely could not be tried yet (offline) is kept for next time.
export async function claimPending({ supabase, storage = browserStorage(), now = Date.now() }, signedIn) {
  const saved = read(storage);
  if (!saved) return null;
  if (now - saved.at > MAX_AGE_MS) { forget(storage); return null; }
  const now_ = identity(signedIn);
  const sameEmail = !!saved.email && now_.email === clean(saved.email);
  const samePhone = !!saved.phone && now_.phone === clean(saved.phone);
  if (!sameEmail && !samePhone) return null; // not the account this ticket was made for
  const { data, error } = await supabase.rpc('claim_merge_ticket', { p_ticket: saved.ticket });
  if (error) {
    if (has(error, 'ticket_invalid')) forget(storage);
    return null;
  }
  forget(storage);
  return { moved: Number(data?.moved) || 0 };
}
