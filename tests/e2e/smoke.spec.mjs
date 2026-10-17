// Smoke tests: no backend needed. They prove the production build serves every page and the shell works.
import { test, expect } from '@playwright/test';

test('home shows hero, steps and the report form', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Fix your street');
  await expect(page.locator('.steps li')).toHaveCount(3);
  await expect(page.getByLabel('What is the problem?')).toBeVisible();
  await expect(page.getByLabel('Where is it?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send report' })).toBeVisible();
});

test('an empty form cannot be sent (the browser blocks it)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Send report' }).click();
  // The fields are `required`, so the browser stops the submit before the app's own message appears.
  const valid = await page.getByLabel('What is the problem?').evaluate((el) => el.validity.valid);
  expect(valid).toBe(false);
  await expect(page.locator('.error')).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

for (const [path, name] of [['/issues', 'Reports'], ['/tracker', 'Tracker'], ['/directory', 'Directory'], ['/my', 'My reports']]) {
  test(`nav reaches ${path}`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.locator('.page-title').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
  });
}

test('moderator desk is not linked from the public nav', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('nav a[href="/admin"]')).toHaveCount(0);
});

test.describe('phone layout', () => {
  test.use({ viewport: { width: 390, height: 800 } });
  test('nav sits at the bottom of the screen', async ({ page }) => {
    await page.goto('/');
    const box = await page.locator('nav.nav').boundingBox();
    expect(box.y).toBeGreaterThan(600);
  });
});

test('offline page and manifest are served', async ({ page, request }) => {
  expect((await request.get('/manifest.webmanifest')).ok()).toBeTruthy();
  await page.goto('/offline');
  await expect(page.locator('.page-title').first()).toBeVisible();
});
