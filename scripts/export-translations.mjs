// Writes a spreadsheet (CSV) a reviewer can open in Excel or Google Sheets: English, the draft, and a column for corrections.
//   node scripts/export-translations.mjs tw > translations/review-tw.csv
// Round-1 scope = the keys the Twi pack covers. For an empty language the draft column is blank: the translator writes it.
import { strings } from '../lib/strings.js';
import { home } from '../lib/homeStrings.js';
import * as scope from '../lib/lang/tw.js';

const code = process.argv[2];
if (!code) { console.error('usage: node scripts/export-translations.mjs <tw|ha|ee|gaa>'); process.exit(1); }
const pack = await import(`../lib/lang/${code}.js`);
const english = { strings, home };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function flatten(v, path, out) {
  if (typeof v === 'function') { out.push([`${path}  [n=1]`, path, 1]); out.push([`${path}  [n=3]`, path, 3]); }
  else if (Array.isArray(v)) v.forEach((x, i) => flatten(x, `${path}.${i}`, out));
  else if (isObj(v)) for (const k of Object.keys(v)) flatten(v[k], `${path}.${k}`, out);
  else out.push([path, path, undefined]);
  return out;
}
const render = (root, path, arg) => { const v = get(root, path); return typeof v === 'function' ? v(arg) : v ?? ''; };
const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;

const rows = [['Where it appears (key)', 'English', `${code} draft`, 'Your correction (leave blank if the draft is right)', 'Notes']];
const keys = [...flatten(scope.strings, 'strings', []), ...flatten(scope.home, 'home', [])];
for (const [label, path, arg] of keys) {
  rows.push([label, render(english, path, arg), render({ strings: pack.strings, home: pack.home }, path, arg), '',
    path.startsWith('strings.emergency') ? 'SAFETY WORDING: please check with extra care' : '']);
}
process.stdout.write('﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n');
