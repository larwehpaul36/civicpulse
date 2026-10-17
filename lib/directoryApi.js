import { supabase, ensureUser } from './supabase.js';

const orNull = (v) => (typeof v === 'string' ? v.trim() || null : v ?? null);

// kind: new_party | correction | coverage | wrong. Throws the database's error (its message is the reason code).
export async function suggestChange({ kind, partyId, name, type, regionId, categoryIds, email, phone, whatsapp, note }) {
  await ensureUser();
  const { error } = await supabase.rpc('suggest_directory_change', {
    p_kind: kind,
    p_party: partyId ?? null,
    p_name: orNull(name),
    p_type: orNull(type),
    p_region: orNull(regionId),
    p_categories: categoryIds ?? [],
    p_email: orNull(email),
    p_phone: orNull(phone),
    p_whatsapp: orNull(whatsapp),
    p_note: orNull(note),
  });
  if (error) throw error;
}

export async function mySuggestions() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];
  const { data, error } = await supabase.rpc('my_directory_suggestions');
  return error ? [] : data ?? [];
}
