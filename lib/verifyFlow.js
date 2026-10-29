// The phone-check steps, with the Supabase client passed in so they can be tested without a network.
// Link first: attaching the phone to this device's anonymous user keeps the person's reports and "My reports".
// If that phone already belongs to another account, sign in to it instead (documented Supabase behaviour).

export const needsPhone = (err) => err?.code === 'PV001' || /phone_verification_required/.test(err?.message ?? '');

const text = (e) => `${e?.code ?? ''} ${e?.message ?? ''}`.toLowerCase();
const taken = (e) => /phone_exists|already (been )?registered|already exists|already taken/.test(text(e));
const rateLimited = (e) => Number(e?.status) === 429 || /rate.?limit/.test(text(e));

export async function requestCode(supabase, phone) {
  const fail = (e) => ({ error: rateLimited(e) ? 'rateLimit' : 'sendFailed' });
  const link = await supabase.auth.updateUser({ phone });
  if (!link.error) return { mode: 'link' };
  if (taken(link.error)) {
    const signIn = await supabase.auth.signInWithOtp({ phone });
    return signIn.error ? fail(signIn.error) : { mode: 'signin' };
  }
  return fail(link.error);
}

export async function confirmCode(supabase, { phone, token, mode }) {
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: mode === 'link' ? 'phone_change' : 'sms' });
  if (!error) return { ok: true };
  if (rateLimited(error)) return { error: 'rateLimit' };
  // Supabase uses one message for "wrong" and "expired", so both count as a wrong try.
  return { error: /expired|invalid|incorrect|otp/.test(text(error)) ? 'wrong' : 'generic' };
}
