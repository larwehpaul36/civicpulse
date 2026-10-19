// Runs axe-core (WCAG 2.0/2.1 A and AA rules) on each page with fake data, in light and dark mode.
// Fails on serious or critical problems; lists the rest. The map's internals (Leaflet, third party) are excluded.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.skip(!process.env.A11Y, 'Run with: npm run test:a11y');

const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
const issues = [
  { id: '11111111-2222-4333-8444-555555555551', party_id: 'pa', category_id: 'c1', status: 'resolved', created_at: day(14), sent_at: day(12), resolved_at: day(9), days_open: 5, confirmation_count: 3, lat: 5.6, lng: -0.19, description: 'Blocked drain' },
  { id: '11111111-2222-4333-8444-555555555552', party_id: 'pa', category_id: 'c1', status: 'sent', created_at: day(6), sent_at: day(5), resolved_at: null, days_open: 6, confirmation_count: 1, lat: 5.61, lng: -0.2, description: null },
];
const parties = [{ id: 'pa', name: 'Office Alpha' }];
const cats = [{ id: 'c1', name: { en: 'Choked gutter' }, category_groups: { name: { en: 'Drains' } } }];
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

test.beforeEach(async ({ page }) => {
  await page.route('**/rest/v1/**', (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const u = req.url();
    const body = u.includes('/public_issues') ? issues : u.includes('/responsible_parties') ? parties : u.includes('/categories') ? cats : [];
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  });
});

for (const scheme of ['light', 'dark']) {
  for (const path of ['/', '/issues', '/tracker', '/directory', '/my', '/offline']) {
    test(`${path} has no serious accessibility problems (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .exclude('.leaflet-container')
        .analyze();
      const report = violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) ${v.help}\n   ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n   ')}`).join('\n');
      if (report) console.log(`\n[${scheme}] ${path}\n${report}`);
      expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'), report).toEqual([]);
    });
  }
}
