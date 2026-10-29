// Health check for a LIVE Supabase project, using only the public (anon) key, exactly what a stranger has.
// Run: npm run check:live        (reads .env.local; needs Node 20.6+)
// It tells you which migration or dashboard setting is missing. Safe to run repeatedly
// (it uploads two tiny test files into your own anonymous user's folder in the photo bucket).
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local'); process.exit(2); }

const sb = createClient(url, key, { auth: { persistSession: false } });
// The bucket accepts only image/jpeg (see 003), like the app's compressed photos.
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
try { await fetch(url, { method: 'HEAD' }); }
catch { console.error(`Cannot reach ${url}. Check NEXT_PUBLIC_SUPABASE_URL (Project Settings > API) and your internet connection.`); process.exit(2); }
const rows = [];
let uid, categoryId;

async function check(name, fix, fn) {
  try {
    const r = await fn();
    rows.push({ name, status: r?.warn ? 'WARN' : 'PASS', note: r?.warn || r?.note || '', fix: r?.warn ? fix : '' });
  } catch (e) {
    rows.push({ name, status: 'FAIL', note: e.message, fix });
  }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

await check('Anonymous sign-in works', 'Supabase > Authentication > Providers > enable "Anonymous sign-ins"', async () => {
  const { data, error } = await sb.auth.signInAnonymously();
  must(!error, error?.message);
  uid = data.user.id;
});
await check('All 16 Ghana regions seeded', 'Run 001 and 002', async () => {
  const { count, error } = await sb.from('regions').select('id', { count: 'exact', head: true });
  must(!error, error?.message); must(count >= 16, `only ${count} regions`);
  return { note: `${count} regions` };
});
await check('At least one category is enabled', 'Run 001, or set categories.enabled = true for your launch categories', async () => {
  const { data, error } = await sb.from('categories').select('id,slug').eq('enabled', true);
  must(!error, error?.message); must(data.length > 0, 'no enabled categories');
  categoryId = data[0].id;
  return { note: data.map((c) => c.slug).join(', ') };
});
await check('"Other problem" category exists (reports not on the list)', 'Run 009_other_category.sql in the Supabase SQL editor', async () => {
  const { data, error } = await sb.from('categories').select('id, enabled').eq('slug', 'other').maybeSingle();
  must(!error, error?.message);
  return data?.enabled ? { note: 'enabled' } : { warn: 'missing or disabled: residents cannot report things that are not on the list' };
});
await check('Public list exposes other_label, and My reports still works', 'Run 009_other_category.sql (check A at the bottom tells you which part failed)', async () => {
  const a = await sb.from('public_issues').select('other_label').limit(1);
  must(!a.error, a.error?.message);
  const b = await sb.rpc('my_reports');
  must(!b.error, b.error?.message);
});
await check('Phone check helper exists (is_phone_verified)', 'Run 011_phone_verified.sql in the Supabase SQL editor', async () => {
  const { data, error } = await sb.rpc('is_phone_verified');
  must(!error, error?.message);
  must(data === false, 'an anonymous visitor should not count as verified');
});
await check('SMS endpoint refuses unsigned requests', 'Deploy the app, then set SEND_SMS_HOOK_SECRET and ARKESEL_API_KEY in Vercel', async () => {
  const site = process.env.NEXT_PUBLIC_SITE_URL || process.env.CHECK_SITE_URL;
  if (!site) return { warn: 'add NEXT_PUBLIC_SITE_URL=https://civicpulse-live.vercel.app to .env.local to test this' };
  const res = await fetch(`${site}/api/auth/send-sms`, { method: 'POST', body: '{}' });
  must(res.status === 401 || res.status === 500, `answered ${res.status}`);
  return res.status === 401 ? { note: 'signature required (good)' } : { warn: 'answers 500: SEND_SMS_HOOK_SECRET or ARKESEL_API_KEY is not set in Vercel yet' };
});
await check('Someone is responsible for something', 'Add rows to category_responsibilities (see dev helpers at the bottom of 004) or add parties in /admin', async () => {
  const { count, error } = await sb.from('category_responsibilities').select('id', { count: 'exact', head: true });
  must(!error, error?.message);
  return count ? { note: `${count} rows` } : { warn: 'empty: new reports get no responsible party yet' };
});
await check('Public list (public_issues) is readable with rounded coordinates', 'Run 004', async () => {
  const { error } = await sb.from('public_issues').select('id,lat,lng,status').limit(1);
  must(!error, error?.message);
});
await check('Duplicate check function exists', 'Run 003', async () => {
  const { error } = await sb.rpc('find_nearby_duplicates', { lat: 5.6, lng: -0.19, cat: categoryId, radius_m: 50 });
  must(!error, error?.message);
});
await check('PRIVACY: exact issue location is hidden from the public', 'Run 003 and 004; the issues table must not expose "location"', async () => {
  const { data, error } = await sb.from('issues').select('location').limit(1);
  if (error) return { note: 'refused, good' };
  must(!data?.some((r) => r.location), 'exact location is readable by anyone!');
  return { warn: 'no rows to prove it (returned nothing). File a report, then run again' };
});
await check('PRIVACY: party contact details are hidden', 'Run 008 (Part 1) NOW. Contacts are public until you do', async () => {
  const { error } = await sb.from('responsible_parties').select('email,phone,whatsapp,notes').limit(1);
  must(error, 'anyone can read email/phone/WhatsApp of responsible parties');
});
await check('SECURITY: public cannot insert responsible parties', 'Run 008 (Part 1)', async () => {
  const { error } = await sb.from('responsible_parties').insert({ name: 'check-live probe', type: 'private' });
  must(error, 'anyone can add responsible parties');
});
await check('SECURITY: moderator functions refuse the public', 'Run 005', async () => {
  const { error } = await sb.rpc('admin_list_issues');
  must(error, 'admin_list_issues answered a non-moderator');
});
await check('Photo bucket accepts an upload to your own folder', 'Run 003 (creates the issue-photos bucket: JPEG only, 2 MB, own folder)', async () => {
  must(uid, 'needs anonymous sign-in first');
  const path = `${uid}/check-live-${Date.now()}-before.jpg`;
  const { error } = await sb.storage.from('issue-photos').upload(path, JPG, { contentType: 'image/jpeg' });
  must(!error, error?.message);
  const again = await sb.storage.from('issue-photos').upload(path, JPG, { contentType: 'image/jpeg' });
  // Your offline queue treats "already exists" as success, so a re-upload must be refused in that wording.
  must(again.error, 're-upload was accepted; fine, but unexpected');
  must(/exist|duplicate|409/i.test(`${again.error.message} ${again.error.statusCode ?? ''}`),
    `re-upload refused with a message the queue may not recognise: "${again.error.message}"`);
  return { note: 're-upload refused as "already exists" (the queue handles it)' };
});

const icon = { PASS: 'PASS', WARN: 'WARN', FAIL: 'FAIL' };
for (const r of rows) {
  console.log(`${icon[r.status]}  ${r.name}${r.note ? `  (${r.note})` : ''}`);
  if (r.fix) console.log(`      fix: ${r.fix}`);
}
const failed = rows.filter((r) => r.status === 'FAIL').length;
console.log(`\n${rows.length - failed - rows.filter((r) => r.status === 'WARN').length} passed, ${rows.filter((r) => r.status === 'WARN').length} warnings, ${failed} failed`);
process.exit(failed ? 1 : 0);
