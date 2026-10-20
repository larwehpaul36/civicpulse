// "Other problem" flow with fake data: no backend needed.
import { test, expect } from '@playwright/test';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const cats = [
  { id: 'c1', slug: 'pothole', name: { en: 'Pothole' }, category_groups: { name: { en: 'Roads' } } },
  { id: 'c9', slug: 'other', name: { en: 'Other problem' }, category_groups: { name: { en: 'Not on the list' } } },
];
const regions = [{ id: 'r1', name: 'Accra', level: 'city', parent_id: null }];
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

test.beforeEach(async ({ page }) => {
  await page.route('**/rest/v1/**', (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const u = req.url();
    const body = u.includes('/categories') ? cats : u.includes('/regions') ? regions : [];
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  });
});

test('"Other problem" asks the person to name it before moving on', async ({ page }) => {
  await page.goto('/');
  const category = page.getByLabel('What is the problem?');
  await expect(category.locator('option')).toHaveCount(3, { timeout: 15_000 }); // choose + two categories
  await expect(page.getByLabel('Name the problem (a few words)')).toHaveCount(0); // hidden for normal categories
  await category.selectOption({ label: 'Not on the list: Other problem' });
  await page.getByLabel('Photo of the problem').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.error')).toContainText('Write a few words');
  await page.getByLabel('Name the problem (a few words)').fill('Fallen tree');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
});
