// Server-only: the PUBLIC facts about one report, for link previews. Same data the public page already shows.
import { createClient } from '@supabase/supabase-js';
import { label } from './i18n.js';
import { categoryTitle } from './categoryTitle.js';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The preview image is built from a copy of the photo, fetched here so a slow photo can never break the card.
async function photoDataUri(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > 1_500_000 ? null : `data:${type};base64,${bytes.toString('base64')}`;
  } catch { return null; }
}

export async function getShare(id) {
  if (!ID.test(id ?? '')) return null;
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const [issue, photos, cats] = await Promise.all([
      db.from('public_issues').select('*').eq('id', id).maybeSingle(),
      db.from('issue_photos').select('kind, storage_path').eq('issue_id', id),
      db.from('categories').select('id, name'),
    ]);
    if (!issue.data) return null;
    const d = issue.data;
    const party = d.party_id
      ? (await db.from('responsible_parties').select('name').eq('id', d.party_id).maybeSingle()).data?.name ?? null
      : null;
    const rows = photos.data ?? [];
    // A fixed problem shows the fix; otherwise the problem.
    const pick = (d.status === 'resolved' && rows.find((p) => p.kind === 'after')) || rows.find((p) => p.kind === 'before');
    const photo = pick
      ? await photoDataUri(db.storage.from('issue-photos').getPublicUrl(pick.storage_path).data.publicUrl)
      : null;
    return { ...d, party, photo, category: categoryTitle(label(cats.data?.find((c) => c.id === d.category_id)?.name) || 'Problem', d.other_label) };
  } catch { return null; }
}
