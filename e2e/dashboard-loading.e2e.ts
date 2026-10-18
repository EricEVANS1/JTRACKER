import { daysFromNow, expect, test, USER_ID } from './support/mockSupabase';

test.beforeEach(({ supabase }) => {
  supabase.seed('applications', [
    {
      id: 'a1', user_id: USER_ID, role_title: 'Support Engineer', status: 'applied', archived: false,
      created_at: daysFromNow(-5), date_applied: daysFromNow(-5), companies: { id: 'c1', name: 'Acme' },
    },
  ]);
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('the welcome screen never flashes before the dashboard while setup status loads', async ({ page }) => {
  // The first-time setup check (profiles) answers after the dashboard's own data.
  await page.route('**/rest/v1/profiles**', async (route) => {
    await delay(1500);
    await route.fallback();
  });

  await page.goto('/dashboard');
  await expect(page.getByRole('status').filter({ hasText: 'Loading dashboard…' })).toBeAttached();
  await page.waitForTimeout(700);
  await expect(page.getByText('Welcome to JTracker')).toHaveCount(0);

  await expect(page.locator('main')).toContainText('What needs attention now');
  await expect(page.getByText('Welcome to JTracker')).toHaveCount(0);
});

test('Refresh shows an indeterminate bar, without a percentage, until the data is back', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('main')).toContainText('What needs attention now');

  await page.route('**/rest/v1/applications**', async (route) => {
    await delay(1000);
    await route.fallback();
  });
  await page.getByRole('button', { name: 'Refresh' }).click();

  const bar = page.getByRole('progressbar', { name: 'Refreshing dashboard' });
  await expect(bar).toBeVisible();
  await expect(bar).not.toHaveAttribute('aria-valuenow', /.*/);
  await expect(page.locator('main [aria-busy="true"]').first()).toBeAttached();

  await expect(bar).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: /^Updated \d{2}:\d{2}$/ })).toBeVisible();
});

test('with reduced motion, skeletons and the refresh bar do not animate', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/rest/v1/applications**', async (route) => {
    await delay(800);
    await route.fallback();
  });

  await page.goto('/dashboard');
  const skeleton = page.locator('.animate-pulse').first();
  await expect(skeleton).toBeAttached();
  expect(await skeleton.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');

  await expect(page.locator('main')).toContainText('What needs attention now');
  await page.getByRole('button', { name: 'Refresh' }).click();
  const segment = page.getByRole('progressbar', { name: 'Refreshing dashboard' }).locator('div');
  await expect(segment).toBeAttached();
  expect(await segment.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});
