import { claimPending, prepareMerge } from './mergeTicket.js';

// The phone-check steps, with the Supabase client passed in so they can be tested without a network.
// Link first: attaching the phone to this device's anonymous user keeps the person's reports and "My reports".
// If that phone already belongs to another account, sign in to it instead (documented Supabase behaviour).

export const needsPhone = (err) => err?.code === 'PV001' || /phone_verification_required/.test(err?.message ?? '');

const text = (e) => `${e?.code ?? ''} ${e?.message ?? ''}`.toLowerCase();
const taken = (e) => /phone_exists|already (been )?registered|already exists|already taken/.test(text(e));
const rateLimited = (e) => Number(e?.status) === 429 || /rate.?limit/.test(text(e));

// `extras` ({ storage, now }) exists so tests can run without a browser.
export async function requestCode(supabase, phone, extras = {}) {
  const fail = (e) => ({ error: rateLimited(e) ? 'rateLimit' : 'sendFailed' });
  const link = await supabase.auth.updateUser({ phone });
  if (!link.error) return { mode: 'link' };
  if (taken(link.error)) {
    // Signing in to the other account replaces this phone's session, so this phone's reports would be left behind.
    // Ask for a merge ticket NOW, while this phone is still itself (migration 024 lets the new account claim it).
    // Best effort: if it cannot be made, signing in still works, exactly as it did before.
    try { await prepareMerge({ supabase, ...extras }, { phone }); } catch { /* go on without it */ }
    const signIn = await supabase.auth.signInWithOtp({ phone });
    return signIn.error ? fail(signIn.error) : { mode: 'signin' };
  }
  return fail(link.error);
}

export async function confirmCode(supabase, { phone, token, mode }, extras = {}) {
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: mode === 'link' ? 'phone_change' : 'sms' });
  if (!error) {
    if (mode !== 'signin') return { ok: true };
    // Now signed in to the account that owns this number: bring this phone's own reports across. Best effort; a ticket that
    // could not be handed over yet is kept and tried again later. Needs migration 024 (before it, the database says no and nothing moves).
    let moved = 0;
    try { moved = (await claimPending({ supabase, ...extras }, { phone }))?.moved ?? 0; } catch { /* the sign-in itself worked */ }
    return { ok: true, moved };
  }
  if (rateLimited(error)) return { error: 'rateLimit' };
  // Supabase uses one message for "wrong" and "expired", so both count as a wrong try.
  return { error: /expired|invalid|incorrect|otp/.test(text(error)) ? 'wrong' : 'generic' };
}
