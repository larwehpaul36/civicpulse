// Optional email for a resident's account. Reporting still needs no account, no email and no phone number.
// Adding an email attaches it to the SAME anonymous account, so every report made so far stays with it.
// On a new phone, or after clearing browser data, signing in with that email brings the reports back.
//
// OFF until NEXT_PUBLIC_EMAIL_ACCOUNTS=1. Switch it on only after docs/email-signin-setup.md is done: Supabase's built-in
// email service sends only to your own team members, so residents get nothing until custom SMTP is set up.
export const EMAIL_ACCOUNTS = process.env.NEXT_PUBLIC_EMAIL_ACCOUNTS === '1';

export const cleanEmail = (value) => String(value ?? '').trim().toLowerCase();
export const looksLikeEmail = (value) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

// What state is this phone's account in?  none (never reported) | anonymous | pending (link sent, not opened) | signedIn.
// "signedIn" is decided by a CONFIRMED email, not by the is_anonymous flag, so it stays right whichever way Supabase flips that flag.
export function accountState(user) {
  if (!user) return { kind: 'none' };
  if (user.email && user.email_confirmed_at) return { kind: 'signedIn', email: user.email };
  if (user.new_email) return { kind: 'pending', email: user.new_email };
  return { kind: 'anonymous' };
}

// Turns a Supabase error into one of a few short codes the screen has words for.
export function explain(error) {
  const code = error?.code ?? '';
  const message = error?.message ?? '';
  if (code === 'email_exists' || /already (been )?registered|already exists/i.test(message)) return 'email_taken';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || error?.status === 429
      || /rate limit|only request this after/i.test(message)) return 'too_soon';
  if (code === 'email_address_invalid' || code === 'validation_failed' || (/invalid/i.test(message) && /email/i.test(message))) return 'bad_email';
  // Set-up problems, not the resident's fault: built-in mail service (team members only), email or manual linking switched off.
  if (code === 'email_address_not_authorized' || code === 'email_provider_disabled' || code === 'manual_linking_disabled'
      || /manual linking/i.test(message)) return 'email_off';
  return 'failed';
}
const fail = (error) => Object.assign(new Error(explain(error)), { cause: error });

// Attach an email to this phone's anonymous account. Supabase emails a link; opening it finishes the job.
export async function linkEmail({ supabase, ensureUser }, email, redirectTo) {
  const address = cleanEmail(email);
  if (!looksLikeEmail(address)) throw new Error('bad_email');
  await ensureUser(); // there must be an anonymous account to attach it to
  const { error } = await supabase.auth.updateUser({ email: address }, { emailRedirectTo: redirectTo });
  if (error) throw fail(error);
  return address;
}

// For a new phone or cleared browser data: email a sign-in link to an address that already has an account.
// Never creates an account, and never says whether the address has one (Supabase answers "otp_disabled" for unknown
// addresses; that is swallowed, so the screen shows the same message either way).
export async function requestSignIn({ supabase, getCaptchaToken }, email, redirectTo) {
  const address = cleanEmail(email);
  if (!looksLikeEmail(address)) throw new Error('bad_email');
  const captchaToken = await getCaptchaToken();
  const { error } = await supabase.auth.signInWithOtp({
    email: address,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo, ...(captchaToken ? { captchaToken } : {}) },
  });
  if (error && error.code !== 'otp_disabled' && !/signups not allowed for otp/i.test(error.message ?? '')) throw fail(error);
  return address;
}

// "Keep my reports": attach the address to this phone's account. If that address ALREADY has an account, Supabase says so,
// and showing that would tell anyone typing addresses which ones have accounts. So in that case we quietly send a
// sign-in link instead, and the caller shows the same message either way. prepare(address) runs first in that case
// (it brings this phone's reports along, see lib/mergeTicket.js); if it throws, nothing is sent.
export async function addEmailOrSignIn({ supabase, ensureUser, getCaptchaToken, prepare }, email, redirectTo) {
  try {
    return await linkEmail({ supabase, ensureUser }, email, redirectTo);
  } catch (err) {
    if (err?.message !== 'email_taken') throw err;
    const address = cleanEmail(email);
    if (prepare) await prepare(address);
    return requestSignIn({ supabase, getCaptchaToken }, address, redirectTo);
  }
}

// Sign out on THIS phone only. Supabase's default would sign the person out on every phone they use.
export const signOutHere = (supabase) => supabase.auth.signOut({ scope: 'local' });
