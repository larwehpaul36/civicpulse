import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Guards against a file being overwritten with an older copy: these are the things the top bar must keep.
const nav = fs.readFileSync(new URL('../components/Nav.js', import.meta.url), 'utf8');
const layout = fs.readFileSync(new URL('../app/layout.js', import.meta.url), 'utf8');

test('the top bar still contains the language switch, the About link and My reports', () => {
  assert.match(nav, /import LanguageSwitch from '@\/components\/LanguageSwitch'/);
  assert.match(nav, /<LanguageSwitch \/>/);
  assert.match(nav, /<MyReportsLink \/>/);
  assert.match(nav, /\['\/about', 'navAbout'/);
});

test('the whole app is wrapped in the language provider', () => {
  assert.match(layout, /<LangProvider>/);
});
