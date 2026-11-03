// Two-step place picker with fake data: region first, then district or municipality. No backend needed.
import { test, expect } from '@playwright/test';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const cats = [{ id: 'c1', slug: 'pothole', name: { en: 'Pothole' }, category_groups: { name: { en: 'Roads' } } }];
const regions = [
  { id: 'g1', name: 'Ashanti', level: 'region', parent_id: null },
  { id: 'g2', name: 'Volta', level: 'region', parent_id: null },
  { id: 'a1', name: 'Kumasi Metropolitan', level: 'area', parent_id: 'g1' },
  { id: 'a2', name: 'Ejisu Municipal', level: 'area', parent_id: 'g1' },
  { id: 'k1', name: 'Kumasi', level: 'city', parent_id: 'g1' }, // an older city entry: must not appear in either dropdown
];
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
test.use({ geolocation: { latitude: 6.6885, longitude: -1.6244 }, permissions: ['geolocation'] });

test.beforeEach(async ({ page }) => {
  await page.route('**/rest/v1/**', (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const u = req.url();
    const body = u.includes('/categories') ? cats : u.includes('/regions') ? regions : [];
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  });
});

test('pick a region, then its district; the review shows both', async ({ page }) => {
  await page.goto('/');
  const category = page.getByLabel('What is the problem?');
  await expect(category.locator('option')).toHaveCount(2, { timeout: 15_000 });
  await category.selectOption({ label: 'Roads: Pothole' });
  await page.getByLabel('Photo of the problem').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  const region = page.getByLabel('Where is it?');
  await expect(region.locator('option')).toHaveCount(3);           // choose + the two regions, no city
  await expect(page.getByLabel('District or municipality (optional)')).toHaveCount(0);

  await region.selectOption({ label: 'Ashanti' });
  const district = page.getByLabel('District or municipality (optional)');
  await expect(district.locator('option')).toHaveText(['Not sure (use the whole region)', 'Ejisu Municipal', 'Kumasi Metropolitan']);

  await region.selectOption({ label: 'Volta' });                    // a region with no districts loaded
  await expect(district).toHaveCount(0);

  await region.selectOption({ label: 'Ashanti' });
  await page.getByLabel('District or municipality (optional)').selectOption({ label: 'Kumasi Metropolitan' });
  await page.getByRole('button', { name: 'Use my location' }).click();
  await expect(page.getByText('Spot marked.')).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.review')).toContainText('Kumasi Metropolitan, Ashanti');
});
