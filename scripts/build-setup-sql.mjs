// Builds supabase/setup_all.sql from the numbered migration files in the project root.
//   node scripts/build-setup-sql.mjs > supabase/setup_all.sql        (optional first argument: the project folder)
// Files with a letter after the number (for example 011b_enable_phone_rules.sql) are opt-in switches and are never included.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? '.');
const files = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
const first = files[0].slice(0, 3);
const last = files.at(-1).slice(0, 3);
const header = process.argv[3] ?? `-- CivicPulse: all migrations ${first}-${last} in order. Paste into the Supabase SQL editor on a FRESH project.`;

let out = `${header}\n-- Generated from the numbered files; edit those, not this. Rebuild: node scripts/build-setup-sql.mjs > supabase/setup_all.sql\n`;
for (const f of files) out += `\n-- ===================== ${f} =====================\n${readFileSync(join(dir, f), 'utf8')}`;
process.stdout.write(out);
