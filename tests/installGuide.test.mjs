import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isIOS, needsInstallGuide, readEnvironment } from '../lib/installGuide.js';
import { strings } from '../lib/strings.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

test('an iPhone in the browser needs the guide; once added to the Home Screen it does not', () => {
  assert.equal(needsInstallGuide({ ua: IPHONE, standalone: false }), true);
  assert.equal(needsInstallGuide({ ua: IPHONE, standalone: true }), false);
});

test('Android phones and computers never see the guide', () => {
  assert.equal(needsInstallGuide({ ua: ANDROID, standalone: false }), false);
  assert.equal(needsInstallGuide({ ua: WINDOWS, platform: 'Win32', standalone: false }), false);
  assert.equal(needsInstallGuide({}), false);
  assert.equal(needsInstallGuide(), false);
});

test('a new iPad (which says it is a Mac) is recognised, a real Mac is not', () => {
  assert.equal(isIOS({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 }), true);
  assert.equal(isIOS({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 }), false);
});

test('readEnvironment reads a browser and never throws', () => {
  const win = { navigator: { userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5, standalone: true }, matchMedia: () => ({ matches: false }) };
  assert.deepEqual(readEnvironment(win), { ua: IPHONE, platform: 'iPhone', maxTouchPoints: 5, standalone: true });
  const viaCss = { navigator: { userAgent: IPHONE }, matchMedia: () => ({ matches: true }) };
  assert.equal(readEnvironment(viaCss).standalone, true);
  assert.deepEqual(readEnvironment(null), {});
  assert.equal(needsInstallGuide(readEnvironment(null)), false);
});

test('every About-page link goes to a page that exists', () => {
  for (const [, href] of strings.about.links) {
    const route = href.split('#')[0] || '/';
    const file = route === '/' ? 'app/page.js' : `app/${route.slice(1)}/page.js`;
    assert.ok(fs.existsSync(new URL(`../${file}`, import.meta.url)), `${href} -> ${file}`);
  }
  assert.ok(fs.existsSync(new URL('../app/privacy/page.js', import.meta.url)));
});

test('the About text names the product and the emergency number, and the guide has its steps', () => {
  assert.ok(strings.about.lead.startsWith('CivicPulse is'));
  assert.ok(strings.about.not[0].includes('112'));
  assert.equal(strings.installGuide.steps.length, 5);
  assert.ok(strings.installGuide.steps.some((x) => x.includes('Add to Home Screen')));
});
