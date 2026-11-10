// "I can see this too": sends the confirmation together with where the phone is right now.
// The database (migration 015) uses that position once, to check the person is near the problem, and then discards it.
// A confirmation is always saved. It only COUNTS toward the public number when the checks in 015 pass.

// Where is this phone? Resolves to { lat, lng }, or null when the person said no, there is no GPS, or it took too long.
// Never rejects, so asking for a position can never stop someone from confirming.
export function getPosition({ geolocation = globalThis.navigator?.geolocation, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    if (!geolocation?.getCurrentPosition) return resolve(null);
    const timer = setTimeout(() => resolve(null), timeoutMs + 500); // some browsers never answer
    const done = (value) => { clearTimeout(timer); resolve(value); };
    try {
      geolocation.getCurrentPosition(
        (p) => done(Number.isFinite(p?.coords?.latitude) && Number.isFinite(p?.coords?.longitude)
          ? { lat: p.coords.latitude, lng: p.coords.longitude } : null),
        () => done(null),
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60000 },
      );
    } catch { done(null); }
  });
}

// The columns arrive with migration 015. If the app is deployed first, the database does not know them yet:
// then send the plain confirmation, exactly as before, so nothing breaks while the migration is pending.
const missingColumn = (e) => e?.code === 'PGRST204' || /could not find the '(lat|lng|counts)' column/i.test(e?.message ?? '')
  || (e?.code === '42703' && /\b(lat|lng|counts)\b/.test(e?.message ?? ''));

// Returns { counted: boolean } on success, or { error } (callers handle 23505 "already confirmed", 42501, and a missing phone check).
export async function sendConfirmation(supabase, { issueId, userId, position }) {
  const base = { issue_id: issueId, user_id: userId };
  const first = await supabase.from('confirmations')
    .insert({ ...base, lat: position?.lat ?? null, lng: position?.lng ?? null })
    .select('counts').maybeSingle();
  if (!first.error) return { counted: first.data?.counts !== false };
  if (!missingColumn(first.error)) return { error: first.error };
  const plain = await supabase.from('confirmations').insert(base);
  return plain.error ? { error: plain.error } : { counted: true };
}
