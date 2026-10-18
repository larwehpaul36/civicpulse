// Live test: files a real report against the Supabase project in .env.local (or CI secrets).
// Run with: npm run test:e2e:live   (use a TEST project: this creates data).
import { test, expect } from '@playwright/test';

test.skip(!process.env.E2E_LIVE, 'Set up a test Supabase project, then run npm run test:e2e:live');

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
test.use({ geolocation: { latitude: 5.6037, longitude: -0.187 }, permissions: ['geolocation'] });

test('reporter files a report and it reaches the public list', async ({ page }) => {
  await page.goto('/');
  const category = page.getByLabel('What is the problem?');
  await expect(category.locator('option')).not.toHaveCount(1, { timeout: 15_000 }); // categories loaded
  await category.selectOption({ index: 1 });
  await page.getByLabel('Photo of the problem').setInputFiles({ name: 'pothole.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByLabel('Where is it?').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Use my location' }).click();
  await expect(page.getByText('Spot marked.')).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByLabel('Details (optional)').fill(`e2e ${new Date().toISOString()}`);
  await page.getByRole('button', { name: 'Send report' }).click();

  // Either "Report sent" or, on a slow link, "Report saved on your phone" is fine; "not sent" is a failure.
  await expect(page.getByText(/Report (sent|saved on your phone)/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Report not sent')).toHaveCount(0);

  await expect(page.getByText('Report sent')).toBeVisible({ timeout: 60_000 }); // queue finished syncing
  await page.goto('/issues');
  await expect(page.locator('.cards li').first()).toBeVisible({ timeout: 20_000 });
});
