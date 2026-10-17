// Categories and regions are kept on the phone so the report form still works with no signal.
import { supabase } from './supabase.js';

const KEY = 'civicpulse:ref:v1';

export function readCachedRefData() {
  try {
    const cached = JSON.parse(localStorage.getItem(KEY));
    return cached?.categories?.length && cached?.regions?.length ? cached : null;
  } catch {
    return null;
  }
}

// Returns fresh data, or null when the request failed (the caller keeps whatever it showed).
export async function fetchRefData() {
  try {
    const [c, r] = await Promise.all([
      supabase.from('categories').select('id, name, category_groups(name)').eq('enabled', true).order('sort'),
      supabase.from('regions').select('id, name, level, parent_id').in('level', ['region', 'city']).order('name'),
    ]);
    if (c.error || r.error || !c.data || !r.data) return null;
    const fresh = { categories: c.data, regions: r.data };
    try { localStorage.setItem(KEY, JSON.stringify(fresh)); } catch { /* storage full: skip caching */ }
    return fresh;
  } catch {
    return null;
  }
}
