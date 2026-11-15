import { expect, test } from './support/mockSupabase';

const html = (page: import('@playwright/test').Page) => page.locator('html');

test('follows the system theme until the user picks one, and keeps the choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/dashboard');
  const theme = page.getByRole('radiogroup', { name: 'Theme' });
  await expect(theme.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
  await expect(html(page)).toHaveClass(/\bdark\b/);

  await theme.getByRole('radio', { name: 'Light' }).click();
  await expect(html(page)).not.toHaveClass(/\bdark\b/);
  await expect(theme.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');

  // The saved choice wins over the system setting after a reload, before the app paints.
  await page.reload();
  await expect(html(page)).not.toHaveClass(/\bdark\b/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f8fafc');

  await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Dark' }).click();
  await expect(html(page)).toHaveClass(/\bdark\b/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#141c31');
  expect(await page.evaluate(() => localStorage.getItem('jtracker-theme'))).toBe('dark');
});

test('documents stay light in the dark theme', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jtracker-theme', 'dark'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/resume-builder/editor');
  await expect(html(page)).toHaveClass(/\bdark\b/);
  const preview = page.locator('.theme-light').first();
  await expect(preview).toBeVisible();
  const bg = await preview.evaluate((el) => getComputedStyle(el).getPropertyValue('--jt-white').trim());
  expect(bg).toBe('255 255 255');
});
