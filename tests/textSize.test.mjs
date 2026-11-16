import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SIZES, KEY, cleanSize, readSize, saveSize, INIT_SCRIPT } from '../lib/textSize.js';

const fake = (init = {}) => { const m = { ...init }; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, m }; };

test('only known sizes are accepted; anything else is normal', () => {
  assert.deepEqual(SIZES, ['normal', 'large', 'larger']);
  for (const v of SIZES) assert.equal(cleanSize(v), v);
  for (const v of [null, undefined, '', 'huge', 'LARGE', 3]) assert.equal(cleanSize(v), 'normal');
});

test('a saved size is read back, and a bad stored value falls back to normal', () => {
  const st = fake();
  assert.equal(saveSize(st, 'large'), true);
  assert.equal(readSize(st), 'large');
  assert.equal(readSize(fake({ [KEY]: '<script>' })), 'normal');
});

test('storage that throws (private browsing) never breaks the page', () => {
  const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readSize(bad), 'normal');
  assert.equal(saveSize(bad, 'large'), false);
  assert.equal(readSize(undefined), 'normal');
});

test('the early script sets the attribute for large sizes only and survives missing storage', () => {
  const run = (stored, throws) => {
    const attrs = {};
    const localStorage = { getItem: () => { if (throws) throw new Error('x'); return stored; } };
    const document = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } };
    new Function('localStorage', 'document', INIT_SCRIPT)(localStorage, document);
    return attrs;
  };
  assert.deepEqual(run('large'), { 'data-textsize': 'large' });
  assert.deepEqual(run('larger'), { 'data-textsize': 'larger' });
  assert.deepEqual(run('normal'), {});
  assert.deepEqual(run('evil'), {});
  assert.deepEqual(run(null, true), {});
});

test('the root layout keeps the language provider, the skip link and the footer together', () => {
  const src = readFileSync(new URL('../app/layout.js', import.meta.url), 'utf8');
  for (const part of ['<LangProvider>', 'className="skip"', '<Nav />', '<SiteFooter />', 'INIT_SCRIPT']) assert.ok(src.includes(part), `layout.js lost ${part}`);
});

test('the footer links to pages that exist', () => {
  const foot = readFileSync(new URL('../components/SiteFooter.js', import.meta.url), 'utf8');
  for (const path of [...foot.matchAll(/href="(\/[a-z-]*)"/g)].map((m) => m[1])) {
    const file = new URL(`../app${path}/page.js`, import.meta.url);
    assert.doesNotThrow(() => readFileSync(file), `footer links to ${path} but app${path}/page.js is missing`);
  }
});
