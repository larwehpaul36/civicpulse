// Supabase Edge Function `notify`: sends web push and email when the database adds a notification.
// Setup is in README.md next to this file. Deploy with: supabase functions deploy notify --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { handleEvent } from './core.js';

const env = (name: string) => Deno.env.get(name) ?? '';

const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const pushReady = Boolean(env('VAPID_PUBLIC_KEY') && env('VAPID_PRIVATE_KEY'));
if (pushReady) webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
const emailReady = Boolean(env('RESEND_API_KEY') && env('EMAIL_FROM'));

const db = {
  async pushSubscriptions(userId: string) {
    const { data } = await supabase.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', userId);
    return data ?? [];
  },
  async deletePushSubscription(endpoint: string) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  },
  async contact(userId: string) {
    const { data } = await supabase.from('notification_contacts').select('email, verified_at, unsubscribe_token').eq('user_id', userId).maybeSingle();
    return data;
  },
};

const sendPush = pushReady
  ? (sub: { endpoint: string; p256dh: string; auth: string }, payload: string) =>
      webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 86400 })
  : undefined;

const sendEmail = emailReady
  ? async (mail: { to: string; subject: string; text: string; headers?: Record<string, string> }) => {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env('EMAIL_FROM'), ...mail }),
      });
      if (!res.ok) throw new Error(`email provider answered ${res.status}`);
    }
  : undefined;

Deno.serve(async (req: Request) => {
  const secret = env('WEBHOOK_SECRET');
  if (req.method !== 'POST' || !secret || req.headers.get('x-webhook-secret') !== secret) {
    return new Response('forbidden', { status: 403 });
  }
  const result = await handleEvent(await req.json(), { db, siteUrl: env('SITE_URL').replace(/\/$/, ''), sendPush, sendEmail });
  return Response.json(result);
});
