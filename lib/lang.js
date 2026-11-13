// Switching language without touching any component. The English text objects (`strings`, `home`) are changed IN PLACE:
// translated values are written over the English ones, and English is written back when the language changes.
// Components that kept a reference to a part of the object (const T = s.tracker2) therefore see the new language too.
// Anything a language does not translate stays English, so a half-finished language never shows a blank.
import { strings } from './strings.js';
import { home } from './homeStrings.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export function cloneDeep(v) {
  if (Array.isArray(v)) return v.map(cloneDeep);
  if (isObj(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = cloneDeep(v[k]); return o; }
  return v; // strings, numbers, functions are shared on purpose
}
export function assignDeep(target, src) {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (isObj(v) && isObj(target[k])) assignDeep(target[k], v);
    else target[k] = cloneDeep(v);
  }
  return target;
}

// Static import strings so the bundler splits each language into its own small file: only the chosen one is downloaded.
const PACKS = {
  tw: () => import('./lang/tw.js'),
  ha: () => import('./lang/ha.js'),
  ee: () => import('./lang/ee.js'),
  gaa: () => import('./lang/gaa.js'),
};

let pristine = null;
let current = 'en';
export const currentLang = () => current;

export async function applyLanguage(code) {
  pristine ??= { strings: cloneDeep(strings), home: cloneDeep(home) };
  const pack = code !== 'en' && PACKS[code] ? await PACKS[code]() : null; // load first: if it fails, nothing has changed
  assignDeep(strings, pristine.strings); assignDeep(home, pristine.home);   // back to English
  if (pack) { assignDeep(strings, pack.strings ?? {}); assignDeep(home, pack.home ?? {}); }
  current = pack ? code : 'en';
  return current;
}
