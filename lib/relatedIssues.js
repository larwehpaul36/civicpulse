// Helpers for linking reports about the same or a related problem. Pure functions, no Supabase here.

const EARTH_RADIUS_M = 6371000;
const rad = (deg) => (deg * Math.PI) / 180;

export function metersBetween(aLat, aLng, bLat, bLng) {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// A moderator can paste a report's ID or its page address (.../issues/<id>); both contain the same UUID.
export function parseIssueId(text) {
  const m = String(text ?? '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0].toLowerCase() : null;
}

// Links are stored once per pair, so the "other end" may be in either column.
export const otherEnd = (link, id) => (link.issue_a === id ? link.issue_b : link.issue_a);
export const linksOf = (links, id) => links.filter((l) => l.issue_a === id || l.issue_b === id);

// Reports that may be the same problem: same type, close by, not rejected, not linked yet. Nearest first.
export function suggestions(issue, all, links, { radiusM = 150, max = 5 } = {}) {
  if (![issue.lat, issue.lng].every(Number.isFinite)) return [];
  const linked = new Set(linksOf(links, issue.id).map((l) => otherEnd(l, issue.id)));
  return all
    .filter((o) => o.id !== issue.id && o.category_id === issue.category_id && o.status !== 'rejected' && !linked.has(o.id))
    .filter((o) => [o.lat, o.lng].every(Number.isFinite))
    .map((o) => ({ issue: o, meters: Math.round(metersBetween(issue.lat, issue.lng, o.lat, o.lng)) }))
    .filter((x) => x.meters <= radiusM)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, max);
}
