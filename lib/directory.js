// Pure helpers for the responsible-party directory. No Supabase here, so tests can import them.

// Verified parties, each with what it handles: coverage = [{ region_id, category_ids }]. Sorted by name.
export function buildDirectory(parties, responsibilities) {
  const byParty = new Map();
  for (const r of responsibilities) {
    const areas = byParty.get(r.party_id) ?? new Map();
    areas.set(r.region_id, [...(areas.get(r.region_id) ?? []), r.category_id]);
    byParty.set(r.party_id, areas);
  }
  return parties
    .filter((p) => p.verified)
    .map((p) => ({
      ...p,
      coverage: [...(byParty.get(p.id) ?? new Map())].map(([region_id, category_ids]) => ({ region_id, category_ids })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// "gutter accra" finds a party whose name, area or problem types contain every word.
export function matchesSearch(entry, query, { catName, areaName }) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [
    entry.name, areaName(entry.region_id),
    ...entry.coverage.flatMap((c) => [areaName(c.region_id), ...c.category_ids.map((id) => catName[id] ?? '')]),
  ].join(' ').toLowerCase();
  return words.every((w) => haystack.includes(w));
}

// What a correction would change, for the moderator: only fields that were filled in and differ from now.
export function changedFields(suggestion, current) {
  return ['name', 'email', 'phone', 'whatsapp']
    .filter((f) => suggestion[f] && suggestion[f] !== current?.[f])
    .map((f) => ({ field: f, from: current?.[f] ?? '', to: suggestion[f] }));
}

// "Osu, Greater Accra" for a city, just the name otherwise.
export function areaLabel(regionId, regionsById) {
  const r = regionsById[regionId];
  if (!r) return '';
  const parent = r.parent_id ? regionsById[r.parent_id] : null;
  return r.level === 'city' && parent ? `${r.name}, ${parent.name}` : r.name;
}
