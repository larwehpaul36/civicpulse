// Everything the app needs for updates: the in-app feed, web push, and the optional email address.
import { supabase, ensureUser } from './supabase.js';
import { urlBase64ToUint8Array } from './pushHelpers.js';

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
export const EMAIL_NOTICES = process.env.NEXT_PUBLIC_EMAIL_NOTICES === '1';

// Reading never creates an account: with no session there is nothing to show.
async function signedInUserId() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

// ---- in-app feed
export async function unreadCount() {
  if (!(await signedInUserId())) return 0;
  const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  return error ? 0 : count ?? 0;
}

export async function loadMine() {
  if (!(await signedInUserId())) return { reports: [], updates: [] };
  const [reports, updates] = await Promise.all([
    supabase.rpc('my_reports'),
    supabase.from('notifications').select('id, issue_id, to_status, created_at, read_at').order('created_at', { ascending: false }).limit(30),
  ]);
  if (reports.error || updates.error) throw reports.error || updates.error;
  return { reports: reports.data ?? [], updates: updates.data ?? [] };
}

export async function markAllRead() {
  await supabase.rpc('mark_notifications_read');
  window.dispatchEvent(new Event('civicpulse:read'));
}

// ---- web push
export function pushSupported() {
  return typeof window !== 'undefined' && Boolean(VAPID_PUBLIC_KEY) &&
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function subscription() {
  const reg = await navigator.serviceWorker.getRegistration();
  return { reg, sub: reg ? await reg.pushManager.getSubscription() : null };
}

// 'unsupported' | 'blocked' | 'on' | 'off'
export async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const { sub } = await subscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

async function saveSubscription(sub) {
  await ensureUser();
  const { endpoint, keys } = sub.toJSON();
  const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth });
  if (error) throw error;
}

export async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const { reg, sub: existing } = await subscription();
  if (!reg?.active) throw new Error('no_worker'); // the worker only runs in a production build
  const sub = existing ?? await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  await saveSubscription(sub);
  return 'on';
}

// If the anonymous account changed (site data cleared) the saved subscription belongs to the old one: re-link it.
export async function relinkPush() {
  const { sub } = await subscription();
  if (sub && Notification.permission === 'granted') await saveSubscription(sub);
}

export async function disablePush() {
  const { sub } = await subscription();
  if (!sub) return;
  await supabase.rpc('remove_push_subscription', { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}

// ---- optional email
export async function getContact() {
  if (!(await signedInUserId())) return null;
  const { data } = await supabase.rpc('my_notification_contact');
  return data?.[0] ?? null;
}
export async function saveContact(email) {
  await ensureUser();
  const { error } = await supabase.rpc('set_notification_contact', { p_email: email });
  if (error) throw error;
}
export async function clearContact() {
  const { error } = await supabase.rpc('clear_notification_contact');
  if (error) throw error;
}
export async function confirmEmail(token) {
  const { data, error } = await supabase.rpc('confirm_notification_email', { p_token: token });
  if (error) throw error;
  return data === true;
}
export async function unsubscribeEmail(token) {
  const { data, error } = await supabase.rpc('unsubscribe_contact', { p_token: token });
  if (error) throw error;
  return data === true;
}
