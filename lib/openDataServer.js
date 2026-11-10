// Server side only: reads the public views with the public key, exactly what any visitor could read.
import { createClient } from '@supabase/supabase-js';
import { fetchAll } from './fetchAll.js';

export async function loadPublicData() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('not configured');
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const [issues, categories, regions, parties, fix] = await Promise.all([
    fetchAll((a, b) => sb.from('public_issues').select('id, category_id, region_id, party_id, severity, status, confirmation_count, created_at, sent_at, resolved_at, days_open, lat, lng').order('id').range(a, b)),
    fetchAll((a, b) => sb.from('categories').select('id, name').order('id').range(a, b)),
    fetchAll((a, b) => sb.from('regions').select('id, name').order('id').range(a, b)),
    fetchAll((a, b) => sb.from('responsible_parties').select('id, name').order('id').range(a, b)),
    fetchAll((a, b) => sb.from('public_fix_checks').select('issue_id, reopen_count').gt('reopen_count', 0).order('issue_id').range(a, b)).catch(() => []), // before 019
  ]);
  return { issues, categories, regions, parties, fix };
}

export function csvResponse(text, filename) {
  return new Response(text, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
