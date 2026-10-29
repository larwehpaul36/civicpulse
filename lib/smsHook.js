// Supabase "Send SMS" hook: Supabase makes the login code and calls our endpoint; we send the text through Arkesel.
// Requests are signed with the Standard Webhooks method: https://www.standardwebhooks.com
import { createHmac, timingSafeEqual } from 'node:crypto';

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

export const smsText = (otp) => `${otp} is your CivicPulse code. It expires in 10 minutes. Never share it.`;

const fail = (status, message) => ({ status, json: { error: { http_code: status, message } } });

export async function handleSendSms({ body, headers, env, fetchImpl = fetch, now }) {
  const { SEND_SMS_HOOK_SECRET: secret, ARKESEL_API_KEY: apiKey, ARKESEL_SENDER_ID: sender = 'CivicPulse' } = env;
  if (!secret || !apiKey) return fail(500, 'SMS is not set up yet');
  const ok = verifySignature({
    id: headers['webhook-id'], timestamp: headers['webhook-timestamp'], signature: headers['webhook-signature'], body, secret, now,
  });
  if (!ok) return fail(401, 'Invalid signature');

  let payload;
  try { payload = JSON.parse(body); } catch { return fail(400, 'Bad request'); }
  const digits = String(payload?.user?.phone ?? '').replace(/\D/g, '');
  const otp = String(payload?.sms?.otp ?? '');
  if (!/^233[25]\d{8}$/.test(digits)) return fail(400, 'Only Ghana mobile numbers can be used for now');
  if (!/^\d{4,8}$/.test(otp)) return fail(400, 'Bad request');

  try {
    const res = await fetchImpl('https://sms.arkesel.com/api/v2/sms/send', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender, message: smsText(otp), recipients: [`+${digits}`] }),
      signal: AbortSignal.timeout(8000),
    });
    const out = await res.json().catch(() => ({}));
    const rejected = JSON.stringify(out?.data ?? '').toLowerCase().includes('invalid');
    if (!res.ok || out?.status !== 'success' || rejected) {
      console.error('Arkesel refused the message', res.status, out?.status, out?.message); // never log the code or the number
      return fail(500, 'The text message could not be sent');
    }
    return { status: 200, json: {} };
  } catch (err) {
    console.error('Arkesel request failed', err?.name);
    return fail(500, 'The text message could not be sent');
  }
}
