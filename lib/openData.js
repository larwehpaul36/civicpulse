// Open data: the same public numbers the website shows, as CSV files anyone can download (journalists, researchers, civil society).
// Only columns that are already public are used. Free text (descriptions), photos, and anything about WHO reported or confirmed
// are never included. Locations are the rounded public ones (about 100 m, about 1 km for sensitive reports).
import { partyStats } from './trackerStats.js';

export const REPORT_COLUMNS = ['id', 'category', 'status', 'severity', 'region', 'office', 'created_at', 'sent_at', 'resolved_at', 'days_open', 'confirmations', 'times_reopened', 'lat', 'lng'];
export const OFFICE_COLUMNS = ['office', 'reports_sent', 'resolved', 'open_now', 'times_reopened', 'median_days_to_fix', 'resolved_percent', 'oldest_open_days'];

// A spreadsheet runs text that starts with = + - @ as a formula. Names come from the community, so neutralise them.
// Real numbers (such as a negative longitude) are written as numbers and are left alone.
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : String(value);
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const toCsv = (columns, rows) =>
  `﻿${[columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\r\n')}\r\n`;

const iso = (t) => (t ? new Date(t).toISOString() : '');

// issues: rows of public_issues; fix: rows of public_fix_checks (optional, empty before migration 019).
export function reportRows({ issues, categories = [], regions = [], parties = [], fix = [] }) {
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const reg = new Map(regions.map((r) => [r.id, r.name]));
  const off = new Map(parties.map((p) => [p.id, p.name]));
  const reopened = new Map(fix.map((f) => [f.issue_id, f.reopen_count]));
  return issues.map((i) => ({
    id: i.id, category: cat.get(i.category_id) ?? '', status: i.status, severity: i.severity,
    region: reg.get(i.region_id) ?? '', office: off.get(i.party_id) ?? '',
    created_at: iso(i.created_at), sent_at: iso(i.sent_at), resolved_at: iso(i.resolved_at),
    days_open: i.days_open, confirmations: i.confirmation_count, times_reopened: reopened.get(i.id) ?? 0,
    lat: i.lat, lng: i.lng,
  }));
}

export function officeRows({ issues, parties = [], fix = [] }, now = Date.now()) {
  const reopened = new Map(fix.map((f) => [f.issue_id, f.reopen_count]));
  const name = new Map(parties.map((p) => [p.id, p.name]));
  return partyStats(issues.map((i) => ({ ...i, reopen_count: reopened.get(i.id) ?? 0 })), now)
    .map((p) => ({
      office: name.get(p.id) ?? '', reports_sent: p.sent, resolved: p.resolved, open_now: p.open, times_reopened: p.reopened,
      median_days_to_fix: p.median, resolved_percent: p.rate, oldest_open_days: p.oldestOpen,
    }))
    .sort((a, b) => a.office.localeCompare(b.office));
}
