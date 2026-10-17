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

test('submitting an empty form explains what is missing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.locator('.error')).toContainText('Choose a problem');
});

for (const [path, name] of [['/issues', 'Reports'], ['/tracker', 'Tracker'], ['/directory', 'Directory'], ['/my', 'My reports']]) {
  test(`nav reaches ${path}`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.locator('.page-title').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name }).first()).toHaveAttribute('aria-current', 'page');
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
