// Places form a tree: region > district/municipality ('area') or city. A report can be filed at any level.
export const placeLabel = (r, byId) =>
  ((r.level === 'city' || r.level === 'area') && byId[r.parent_id] ? `${r.name}, ${byId[r.parent_id].name}` : r.name);

export const districtsOf = (regions, regionId) =>
  regions.filter((r) => r.level === 'area' && r.parent_id === regionId).sort((a, b) => a.name.localeCompare(b.name));

// For a chosen place id, which region is it in? (A region is its own region.)
export function regionOf(place) {
  if (!place) return '';
  return place.level === 'region' ? place.id : place.parent_id ?? '';
}

// The place and everything above it: [district, region, country].
export function placeChain(id, byId) {
  const out = [];
  let cur = byId[id];
  while (cur && !out.includes(cur.id)) { out.push(cur.id); cur = byId[cur.parent_id]; }
  return out;
}

// Offices that could plausibly handle a report at this place: its own district, the region above it, national ones,
// and (for a report filed at region level) the district offices inside that region.
export function officesNear(parties, regions, placeId) {
  const byId = Object.fromEntries(regions.map((r) => [r.id, r]));
  const chain = new Set(placeChain(placeId, byId));
  const inside = new Set(regions.filter((r) => r.parent_id === placeId).map((r) => r.id));
  return parties.filter((p) => !p.region_id || chain.has(p.region_id) || inside.has(p.region_id));
}
