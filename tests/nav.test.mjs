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

test('the language switch is in the top bar, NOT inside the phone bottom bar (it overflowed there)', () => {
  const navBlock = nav.slice(nav.indexOf('<nav className="nav"'), nav.indexOf('</nav>'));
  assert.ok(!navBlock.includes('LanguageSwitch'), 'LanguageSwitch must not be inside <nav className="nav">');
  assert.match(nav, /<div className="topbar-tools"><TextSizeButton \/><LanguageSwitch \/><MenuButton \/><\/div>/);
});

test('bar labels never wrap onto two lines', () => {
  const css = fs.readFileSync(new URL('../components/topbar.css', import.meta.url), 'utf8');
  assert.match(css, /\.nav a[^{]*\{[^}]*white-space:\s*nowrap/);
});

test('phone bottom bar keeps five equal columns so the camera button stays centred in any language', () => {
  const css = fs.readFileSync(new URL('../components/topbar.css', import.meta.url), 'utf8');
  assert.match(css, /grid-template-columns:\s*1fr 1fr 76px 1fr 1fr/);
  assert.match(nav, /<NavIcon href=\{href\} \/>/);
});

test('Report (home) and About stay hidden on phones, after the layout rule that could show them again', () => {
  const css = fs.readFileSync(new URL('../components/topbar.css', import.meta.url), 'utf8');
  const hide = css.indexOf('.topbar .nav a.navhome, .topbar .nav a.navabout { display: none; }');
  const layout = css.indexOf('display: flex; flex-direction: column');
  assert.ok(hide > -1, 'hiding rule missing');
  assert.ok(hide > layout, 'hiding rule must come after the rule that sets display:flex');
});

test('desktop has a gold "Report a problem" button, last in the bar; it is a CTA, not a tab', () => {
  const css = fs.readFileSync(new URL('../components/topbar.css', import.meta.url), 'utf8');
  const navBlock = nav.slice(nav.indexOf('<nav className="nav"'), nav.indexOf('</nav>'));
  assert.ok(navBlock.indexOf('navcta') > navBlock.indexOf('<MyReportsLink />'), 'the button comes after every tab, so tab order matches the screen');
  assert.match(navBlock, /navhome navcta/, 'keeps navhome so the phone rule still hides it');
  assert.match(css, /a\.navcta\[aria-current='page'\]/, 'stays gold on the home page');
  assert.match(fs.readFileSync(new URL('../lib/strings.js', import.meta.url), 'utf8'), /navReportCta: 'Report a problem'/);
  assert.match(navBlock, /aria-label=\{s\.navReportCta\}/, 'the full name stays as the accessible name when the label is shortened');
});

test('the desktop button shrinks in steps (full name, "Report", camera icon) so the bar never overflows on tablets', () => {
  const css = fs.readFileSync(new URL('../components/topbar.css', import.meta.url), 'utf8');
  assert.match(css, /\.ctamore \{ display: none; \}/);
  assert.match(css, /\.ctaicon \{ display: block;/);
  assert.match(nav, /className="ctaicon"[^>]*aria-hidden="true"/);
});

test('tablets get a two-row bar, so a language picker can never push the buttons off the edge (it did at 768px)', () => {
  const css = fs.readFileSync(new URL('../components/topbar.css', import.meta.url), 'utf8');
  const block = css.slice(css.lastIndexOf('@media (min-width: 40.01rem) and (max-width: 55.99rem)'));
  assert.match(block, /\.topbar-in \{ flex-wrap: wrap;/);
  assert.match(block, /\.topbar \.nav \{ order: 3; flex: 1 1 100%;/);
  assert.match(block, /\.topbar-tools \{ order: 2; margin-left: auto; \}/);
  assert.match(block, /a\.navcta \.ctaicon \{ display: none; \}/, 'the full name shows again, not just the camera');
  assert.ok(css.lastIndexOf('55.99rem') > css.lastIndexOf('47.99rem'), 'comes after the small-tablet rules so it wins');
});
