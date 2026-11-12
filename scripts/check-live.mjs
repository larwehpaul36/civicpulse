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
let captchaOn = false; // Supabase refuses scripted sign-ins that lack the Cloudflare check

async function check(name, fix, fn) {
  try {
    const r = await fn();
    rows.push({ name, status: r?.warn ? 'WARN' : 'PASS', note: r?.warn || r?.note || '', fix: r?.warn && !r?.skipped ? fix : '' });
  } catch (e) {
    rows.push({ name, status: 'FAIL', note: e.message, fix });
  }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

await check('Anonymous sign-in works (or is protected by the bot check)', 'Supabase > Authentication > Providers > enable "Anonymous sign-ins"', async () => {
  const { data, error } = await sb.auth.signInAnonymously();
  if (error && /captcha/i.test(error.message)) {
    captchaOn = true;
    return { note: 'refused without the bot check, as it should be (the app passes the check; this script cannot)' };
  }
  must(!error, error?.message);
  uid = data.user.id;
});
await check('Bot protection (Cloudflare Turnstile) is on', 'Supabase > Authentication > Attack Protection > enable CAPTCHA protection (see docs/turnstile-setup.md)', async () => (
  captchaOn ? { note: 'on' } : { warn: 'off: anyone can create accounts with a script' }
));
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
  if (!uid && captchaOn) return { warn: 'public list is fine; My reports not tested (this script cannot sign in while bot protection is on)', skipped: true };
  const b = await sb.rpc('my_reports');
  must(!b.error, b.error?.message);
});
await check('Phone check helper exists (is_phone_verified). Its two rules stay OFF until 011b is run', 'Run 011_phone_verified.sql in the Supabase SQL editor (it leaves the rules off). Confirm: select tgname, tgenabled from pg_trigger where tgname in (\'confirmations_need_phone\',\'issues_need_phone\'); both must show D while phone login is paused', async () => {
  const { data, error } = await sb.rpc('is_phone_verified');
  must(!error, error?.message);
  must(data === false, 'an anonymous visitor should not count as verified');
});
await check('Confirmations are checked for account age, distance and daily cap (015)', 'Run 015_confirmation_quality.sql in the Supabase SQL editor. Deploy the app BEFORE running it: the new app also works without it', async () => {
  const { error } = await sb.from('confirmations').select('counts').limit(1);
  must(!error, error?.message);
});
await check('PRIVACY: nobody can read exact locations through issue_latlng', 'Run 015 again: it closes issue_latlng() to everyone. Until then exact locations can leak', async () => {
  const { error } = await sb.rpc('issue_latlng', { p_issue: '00000000-0000-0000-0000-000000000000' });
  must(error, 'issue_latlng answered the public');
});
await check('PRIVACY: moderators\' contact-log notes are hidden from the public', 'Run 016_contact_log_private_notes.sql', async () => {
  const { error } = await sb.from('contact_attempts').select('note').limit(1);
  must(error, 'anyone can read the notes on the contact log');
  const ok = await sb.from('contact_attempts').select('channel, response_received, created_at').limit(1);
  must(!ok.error, `the public report page needs these columns: ${ok.error?.message}`);
});
await check('Reports can follow a resident who signs in on a new phone (017)', 'Run 017_merge_anonymous_reports.sql (needed only if NEXT_PUBLIC_EMAIL_ACCOUNTS=1)', async () => {
  const r = await sb.rpc('claim_merge_ticket', { p_ticket: 'check-live' });
  if (r.error && /Could not find the function/i.test(r.error.message)) return { warn: '017 not run yet: only needed for email sign-in' };
  must(r.error, 'claim_merge_ticket answered a signed-out visitor');
  const t = await sb.from('merge_tickets').select('token_hash').limit(1);
  must(t.error, 'anyone can read the merge ticket table');
});
await check('"Is it fixed?" answers work and stay private (019)', 'Run 019_fix_checks.sql in the Supabase SQL editor', async () => {
  const v = await sb.from('public_fix_checks').select('issue_id, reopen_count').limit(1);
  if (v.error && /does not exist|schema cache|Could not find/i.test(v.error.message)) return { warn: '019 not run yet: neighbours cannot say whether a fix is real' };
  must(!v.error, `public_fix_checks: ${v.error?.message}`);
  const t = await sb.from('fix_checks').select('user_id').limit(1);
  must(t.error, 'anyone can read who answered');
});
await check('Moderators can see "Is it fixed?" totals (020)', 'Run 020_admin_fix_checks.sql after 019', async () => {
  const r = await sb.rpc('admin_fix_check_summary');
  if (r.error && /Could not find the function|does not exist/i.test(r.error.message)) return { warn: '020 not run yet (needs 019 first)' };
  must(r.error, 'admin_fix_check_summary answered a signed-out visitor');
});
await check('Office replies work and stay private (021)', 'Run 021_office_replies.sql in the Supabase SQL editor', async () => {
  const v = await sb.from('office_replies').select('id, kind, body, expected_date').limit(1);
  if (v.error && /does not exist|schema cache|Could not find/i.test(v.error.message)) return { warn: '021 not run yet: offices have no way to reply in public' };
  must(!v.error, `office_replies: ${v.error?.message}`);
  const p = await sb.from('office_replies').select('relayed_by').limit(1);
  must(p.error, 'anyone can read which moderator relayed a reply');
  const w = await sb.rpc('admin_add_office_reply', { p_issue: '00000000-0000-0000-0000-000000000000', p_kind: 'reply', p_body: 'x' });
  must(w.error, 'admin_add_office_reply answered a signed-out visitor');
});
await check('The tracker can read more than 1000 reports (paging)', 'Check public_issues is readable', async () => {
  const r = await sb.from('public_issues').select('id', { count: 'exact', head: true });
  must(!r.error, `public_issues: ${r.error?.message}`);
  if (r.count > 1000) return { warn: `${r.count} reports: the tracker, /monthly and /data read them page by page, as they should` };
});
await check('All 261 districts exist, and each has an office', 'Run 012_districts.sql, then 013_assembly_offices.sql in the Supabase SQL editor', async () => {
  const areas = await sb.from('regions').select('id').eq('level', 'area');
  must(!areas.error, areas.error?.message);
  if (areas.data.length === 0) return { warn: 'no districts yet: run 012_districts.sql' };
  must(areas.data.length === 261, `found ${areas.data.length} districts, expected 261`);
  const parties = await sb.from('responsible_parties').select('region_id');
  must(!parties.error, parties.error?.message);
  const covered = new Set(parties.data.map((p) => p.region_id));
  const missing = areas.data.filter((a) => !covered.has(a.id)).length;
  return missing ? { warn: `${missing} districts have no office yet: run 013_assembly_offices.sql` } : { note: '261 districts, all with an office' };
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
  if (!uid && captchaOn) return { warn: 'skipped: this script cannot sign in while bot protection is on. File a test report on the site instead.', skipped: true };
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
