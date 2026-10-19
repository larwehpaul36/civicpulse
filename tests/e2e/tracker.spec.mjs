// Tracker with fake data: no backend needed. Supabase requests are answered by the test itself.
import { test, expect } from '@playwright/test';

const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
const sentRow = (id, party, sentAgo, fixDays) => ({
  id, party_id: party, category_id: 'c1', created_at: day(sentAgo + 1), sent_at: day(sentAgo),
  status: fixDays === null ? 'sent' : 'resolved', resolved_at: fixDays === null ? null : day(sentAgo - fixDays),
});
const issues = [sentRow('1', 'pa', 12, 2), sentRow('2', 'pa', 10, 4), sentRow('3', 'pa', 6, null), sentRow('4', 'pb', 20, null), sentRow('5', 'pb', 9, null)];
const parties = [{ id: 'pa', name: 'Office Alpha' }, { id: 'pb', name: 'Office Beta' }];
const cats = [{ id: 'c1', name: { en: 'Choked gutter' } }];
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

test('tracker shows the numbers, the trend chart and one card per office', async ({ page }) => {
  await page.goto('/tracker');
  await expect(page.locator('.tile')).toHaveCount(4);
  await expect(page.locator('.tile').first()).toContainText('5');
  await expect(page.locator('svg[role="img"]').first()).toBeVisible();
  const cards = page.locator('.pcard');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('Office Alpha');
  await expect(cards.first()).toContainText('3 days'); // median of 2 and 4
  await expect(cards.nth(1)).toContainText('Early data');
});

test('sorting by backlog puts the office with the most open cases first', async ({ page }) => {
  await page.goto('/tracker');
  await page.getByRole('button', { name: 'Biggest backlog', exact: true }).click();
  await expect(page.locator('.pcard').first()).toContainText('Office Beta');
});

test('the home page shows the fastest offices, but only those with enough cases', async ({ page }) => {
  await page.goto('/');
  const teaser = page.locator('.teaser');
  await expect(teaser).toContainText('Office Alpha', { timeout: 15_000 }); // 3 cases sent, 2 fixed
  await expect(teaser).not.toContainText('Office Beta'); // only 2 cases and none fixed: not ranked
});
