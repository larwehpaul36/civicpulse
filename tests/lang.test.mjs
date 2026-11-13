import test from 'node:test';
import assert from 'node:assert/strict';
import { strings } from '../lib/strings.js';
import { home } from '../lib/homeStrings.js';
import { assignDeep, cloneDeep, applyLanguage, currentLang } from '../lib/lang.js';
import { label } from '../lib/i18n.js';
import { LANGUAGES, visibleLanguages, isVisible, htmlLang } from '../lib/languages.js';

const englishSubmit = strings.submit;

test('assignDeep writes into the same objects, so earlier references see the change', () => {
  const t = { a: { b: 'x', c: 'y' }, list: [1, 2] };
  const ref = t.a;
  assignDeep(t, { a: { b: 'NEW' }, list: [9] });
  assert.equal(ref.b, 'NEW'); assert.equal(ref.c, 'y');   // untouched siblings stay
  assert.deepEqual(t.list, [9]);
});

test('cloneDeep copies data but keeps functions', () => {
  const f = () => 1; const o = { a: [{ b: 1 }], f }; const c = cloneDeep(o);
  assert.notEqual(c.a, o.a); assert.equal(c.f, f); assert.deepEqual(c.a, o.a);
});

test('switching language changes the text objects in place, and English comes back exactly', async () => {
  const before = JSON.stringify(strings) + JSON.stringify(home);
  const flowRef = strings.flow, sevRef = strings.severityOptions, homeRef = home;      // like `const T = s.something` in a component
  assert.equal(await applyLanguage('tw'), 'tw');
  assert.notEqual(strings.submit, englishSubmit);
  assert.equal(flowRef.next, 'Ɛdi hɔ');                 // an old reference sees the new language
  assert.equal(sevRef.hazard, 'Ɛyɛ asiane seesei');
  assert.equal(homeRef.cta, 'Ka ɔhaw ho amanneɛ');
  assert.equal(currentLang(), 'tw');
  assert.equal(strings.flow.of(2), 'Anamɔn 2 wɔ 3 mu'); // functions work
  assert.ok(strings.admin.title, 'untranslated parts stay English');
  assert.equal(await applyLanguage('ha'), 'ha');
  assert.equal(strings.submit, 'Aika rahoto');
  assert.equal(flowRef.next, 'Na gaba');                // Twi did not leak into Hausa
  assert.equal(await applyLanguage('en'), 'en');
  assert.equal(strings.submit, englishSubmit);
  assert.equal(JSON.stringify(strings) + JSON.stringify(home), before, 'English must be restored byte for byte');
});

test('an unknown language, or an empty template, leaves English showing', async () => {
  assert.equal(await applyLanguage('xx'), 'en');
  assert.equal(strings.submit, englishSubmit);
  assert.equal(await applyLanguage('ee'), 'ee');        // empty pack: loads fine, changes nothing
  assert.equal(strings.submit, englishSubmit);
  await applyLanguage('en');
});

test('label() uses the chosen language and falls back to English', async () => {
  const cat = { en: 'Pothole', tw: 'Ɔkwan so amoa' };
  assert.equal(label(cat), 'Pothole');
  await applyLanguage('tw');
  assert.equal(label(cat), 'Ɔkwan so amoa');
  assert.equal(label({ en: 'Only English' }), 'Only English');
  assert.equal(label(undefined), '');
  await applyLanguage('en');
});

// Every language file must only translate things that exist, in the same shape, so a typo cannot break a screen.
function compare(en, tr, path, problems) {
  for (const k of Object.keys(tr)) {
    const p = `${path}.${k}`;
    if (!(k in en)) { problems.push(`${p}: no such key in English`); continue; }
    const a = en[k], b = tr[k];
    if (typeof a === 'function') {
      if (typeof b !== 'function') { problems.push(`${p}: must be a function`); continue; }
      for (const n of [0, 1, 2, 3, 12]) { const r = b(n); if (typeof r !== 'string' || !r.trim()) problems.push(`${p}(${n}) gives no text`); }
    } else if (Array.isArray(a)) {
      if (!Array.isArray(b) || b.length !== a.length) { problems.push(`${p}: must be a list of ${a.length}`); continue; }
      a.forEach((x, i) => { if (x && typeof x === 'object') compare(x, b[i], `${p}.${i}`, problems); else if (typeof b[i] !== typeof x) problems.push(`${p}.${i}: wrong type`); });
    } else if (a && typeof a === 'object') {
      if (!b || typeof b !== 'object') problems.push(`${p}: must be an object`); else compare(a, b, p, problems);
    } else {
      if (typeof b !== 'string' || !b.trim()) problems.push(`${p}: must be non-empty text`);
      else if (/TODO|FIXME|XXX/.test(b)) problems.push(`${p}: still has a placeholder`);
    }
  }
}
for (const l of LANGUAGES.filter((x) => x.code !== 'en')) {
  test(`${l.code} language file has the same shape as English`, async () => {
    const pack = await import(`../lib/lang/${l.code}.js`);
    const problems = [];
    compare(strings, pack.strings ?? {}, 'strings', problems);
    compare(home, pack.home ?? {}, 'home', problems);
    assert.deepEqual(problems, []);
    if (l.status === 'draft') assert.ok(Object.keys(pack.strings).length > 20, 'a draft should have real content');
    if (l.status === 'empty') assert.equal(Object.keys(pack.strings).length + Object.keys(pack.home).length, 0, 'an "empty" language must really be empty');
  });
}

test('a translation keeps the numbers and the emergency number from the English text', async () => {
  const tw = await import('../lib/lang/tw.js'), ha = await import('../lib/lang/ha.js');
  for (const p of [tw, ha]) {
    assert.ok(p.strings.emergency.lead.includes('112'), 'the free emergency number must stay in the text');
    assert.ok(p.strings.flow.of(2).includes('2') && p.strings.flow.of(2).includes('3'));
  }
});

test('which languages residents can see: nothing unreviewed unless the preview switch is on', () => {
  assert.deepEqual(visibleLanguages(false).map((l) => l.code), ['en']);
  assert.deepEqual(visibleLanguages(true).map((l) => l.code), ['en', 'tw', 'ha']);   // empty ones never show
  assert.equal(isVisible('ee', true), false);
  assert.equal(isVisible('tw', false), false);
  assert.equal(isVisible('tw', true), true);
  assert.equal(htmlLang('gaa'), 'gaa'); assert.equal(htmlLang('zz'), 'en');
});
