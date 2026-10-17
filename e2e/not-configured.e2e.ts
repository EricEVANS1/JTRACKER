// Runs against a server built without the Supabase settings.
import { expect, test } from '@playwright/test';

for (const path of ['/dashboard', '/auth', '/share/abc']) {
  test(`${path} names the missing settings instead of showing a blank page`, async ({ page }) => {
    await page.goto(path);

    const alert = page.getByRole('alert');
    await expect(alert).toContainText('JTracker is not configured');
    await expect(alert).toContainText('VITE_SUPABASE_URL');
    await expect(alert).toContainText('VITE_SUPABASE_ANON_KEY');
  });
}
