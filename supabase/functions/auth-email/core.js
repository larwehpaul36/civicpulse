// The logic of the `auth-email` Edge Function (Supabase "Send Email" hook), with everything it talks to passed in,
// so tests/authEmail.test.mjs can run it in Node. It is OPTIONAL: see README.md next to this file.
//
// What it does: Supabase makes the sign-in link and calls this function instead of sending the email itself.
// The function first asks the database (migration 018) whether this person may be sent another email, and only then
// sends it through Resend. Moderators are always allowed and do not count toward the limits for residents.
// The text below is English only (a Deno function cannot import strings.js).
import { createHmac, timingSafeEqual } from 'node:crypto';

// Same Standard Webhooks check as lib/smsHook.js, copied here because a deployed function cannot import from the app.
export function verifySignature({ id, timestamp, signature, body, secret, now = Date.now(), toleranceSec = 300 }) {
  if (!id || !timestamp || !signature || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > toleranceSec) return false;
  const key = Buffer.from(secret.replace(/^v1,/, '').replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

const fail = (status, message) => ({ status, json: { error: { http_code: status, message } } });

// Messages about changes already made. Not sign-in links, so they are not sent and never use up the allowance.
const NOTICES = /_notification$/;

const SUBJECTS = {
  magiclink: 'Your CivicPulse sign-in link',
  email: 'Your CivicPulse sign-in link',
  signup: 'Confirm your email for CivicPulse',
  invite: 'You have been invited to CivicPulse',
  recovery: 'Reset your CivicPulse access',
  email_change: 'Confirm your email for CivicPulse',
  reauthentication: 'Your CivicPulse confirmation code',
};

export const verifyLink = ({ supabaseUrl, tokenHash, type, redirectTo }) =>
  `${supabaseUrl.replace(/\/$/, '')}/auth/v1/verify?token=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(type)}&redirect_to=${encodeURIComponent(redirectTo ?? '')}`;

export function mailText(type, link, code) {
  if (type === 'reauthentication') return `Your CivicPulse confirmation code is ${code}. It expires soon. Never share it.\n`;
  const lead = type === 'email_change' || type === 'signup' ? 'Open this link on your phone to confirm your email:' : 'Open this link on your phone to sign in:';
  return `${lead}\n\n${link}\n\nIf you did not ask for this, you can ignore this email. The link only works once and expires soon.\n`;
}

// Who gets which email. Supabase pairs each code with the OPPOSITE hash name for email changes ("for backward
// compatibility"), so the new address uses token_hash. An account with no email yet (every anonymous phone) has no
// current address, so only the new one is written to.
export function recipients(payload) {
  const { user = {}, email_data: d = {} } = payload ?? {};
  const type = d.email_action_type;
  if (type === 'email_change') {
    const out = [];
    const to = user.new_email || user.email_new;
    if (to && (d.token_hash || d.token_hash_new)) out.push({ to, tokenHash: d.token_hash || d.token_hash_new, code: d.token_new || d.token });
    if (user.email && user.new_email && d.token_hash_new && d.token_hash) out.push({ to: user.email, tokenHash: d.token_hash_new, code: d.token });
    return out;
  }
  return user.email && d.token_hash ? [{ to: user.email, tokenHash: d.token_hash, code: d.token }] : [];
}

// db.allow(userId, to, type) -> { allowed, reason }. If the database cannot be reached the email is sent anyway
// (fails OPEN): a broken counter must never lock moderators or residents out of signing in.
export async function handleSendEmail({ body, headers, env, db, fetchImpl = fetch, now, log = console.error }) {
  const { SEND_EMAIL_HOOK_SECRET: secret, RESEND_API_KEY: apiKey, EMAIL_FROM: from, SUPABASE_URL: supabaseUrl } = env;
  if (!secret || !apiKey || !from || !supabaseUrl) return fail(500, 'Email is not set up yet');
  const ok = verifySignature({
    id: headers['webhook-id'], timestamp: headers['webhook-timestamp'], signature: headers['webhook-signature'], body, secret, now,
  });
  if (!ok) return fail(401, 'Invalid signature');

  let payload;
  try { payload = JSON.parse(body); } catch { return fail(400, 'Bad request'); }
  const type = payload?.email_data?.email_action_type;
  if (typeof type !== 'string' || !payload?.user?.id) return fail(400, 'Bad request');
  if (NOTICES.test(type)) return { status: 200, json: {} };
  if (!SUBJECTS[type]) return fail(400, 'Unsupported email type');

  const mails = recipients(payload);
  if (!mails.length) return fail(400, 'Bad request');

  for (const m of mails) {
    let verdict;
    try { verdict = await db.allow(payload.user.id, m.to, type); }
    catch (err) { log('email limit check failed, sending anyway', err?.name); verdict = { allowed: true, reason: 'unchecked' }; }
    if (!verdict?.allowed) {
      log('email held back', verdict?.reason); // never log the address
      return fail(429, 'Too many sign-in emails. Please try again later.');
    }
    try {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, to: [m.to], subject: SUBJECTS[type],
          text: mailText(type, verifyLink({ supabaseUrl, tokenHash: m.tokenHash, type, redirectTo: payload.email_data.redirect_to }), m.code),
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) { log('email provider refused the message', res.status); return fail(500, 'The email could not be sent'); }
    } catch (err) {
      log('email request failed', err?.name);
      return fail(500, 'The email could not be sent');
    }
  }
  return { status: 200, json: {} };
}
