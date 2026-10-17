// Runs against a server built without the Google and Microsoft client IDs.
import { expect, test } from './support/mockSupabase';

test('email providers without a client ID say so and cannot be connected', async ({ page }) => {
  await page.goto('/email-sync');

  const main = page.locator('main');
  await expect(main).toContainText('Gmail sign-in is not set up for this site yet');
  await expect(main).toContainText('Outlook sign-in is not set up for this site yet');
  await expect(page.getByRole('button', { name: 'Connect Gmail' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Connect Outlook' })).toBeDisabled();
});

test('the rest of the app still works', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('main')).toContainText('What needs attention now');
});
