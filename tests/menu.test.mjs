import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { MENU_ITEMS } from '../lib/menuItems.js';
import { strings } from '../lib/strings.js';
import { optionLabel, SHORT, NARROW_QUERY } from '../lib/languageLabel.js';

const here = (f) => new URL(f, import.meta.url);

test('every menu item goes to a page that exists and has wording', () => {
  assert.deepEqual(MENU_ITEMS.map((m) => m[0]), ['/about', '/accessibility', '/privacy', '/data']);
  for (const [href, key] of MENU_ITEMS) {
    assert.ok(existsSync(here(`../app${href}/page.js`)), `${href} has no page`);
    assert.equal(typeof strings.footer[key], 'string', `no wording for ${key}`);
  }
  assert.ok(strings.footer.menu && strings.footer.menuLabel);
});

test('the top bar has the menu button, and the footer still links to the same pages (backup)', () => {
  assert.match(readFileSync(here('../components/Nav.js'), 'utf8'), /<MenuButton \/>/);
  const foot = readFileSync(here('../components/SiteFooter.js'), 'utf8');
  for (const [href] of MENU_ITEMS) assert.ok(foot.includes(`href="${href}"`), `footer lost ${href}`);
});

test('the menu closes on Escape, on a tap outside and when a page opens, and is a proper disclosure button', () => {
  const src = readFileSync(here('../components/MenuButton.js'), 'utf8');
  for (const part of ["e.key === 'Escape'", 'menu-scrim', 'usePathname', 'aria-expanded', 'aria-controls="topmenu"']) assert.ok(src.includes(part), `MenuButton lost ${part}`);
});

test('the menu is for phones only: hidden on computers', () => {
  const css = readFileSync(here('../components/topbar.css'), 'utf8');
  assert.match(css, /\.menubtn \{ display: none; \}/);
  assert.match(css, /@media \(min-width: 40\.01rem\) \{ \.menu-panel, \.menu-scrim \{ display: none; \} \}/);
});

test('language pill: full name normally, short code on the smallest phones', () => {
  const o = { code: 'ha', native: 'Hausa' };
  assert.equal(optionLabel(o, false), 'Hausa');
  assert.equal(optionLabel(o, true), 'HA');
  assert.equal(optionLabel({ code: 'gaa', native: 'Ga' }, true), 'GA');
  assert.equal(optionLabel({ code: 'xx', native: 'X' }, true), 'XX');
  assert.ok(Object.keys(SHORT).length >= 5);
  assert.match(NARROW_QUERY, /max-width/);
});
