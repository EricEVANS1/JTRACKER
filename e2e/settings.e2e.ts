import { expect, test, USER_ID } from './support/mockSupabase';

test.beforeEach(({ supabase }) => {
  supabase.seed('user_settings', [
    { user_id: USER_ID, ai_email_analysis_enabled: true, ai_confidence_threshold: 80, gmail_sync_enabled: true, gmail_max_emails_per_sync: 50, gmail_recruitment_only: true },
  ]);
});

test('Notifications tab describes the alerts instead of showing switches that do nothing', async ({ page }) => {
  await page.goto('/settings?tab=notifications');

  const main = page.locator('main');
  await expect(main).toContainText('Application reminders');
  await expect(main).toContainText('Shared opportunities');
  await expect(main).toContainText('All alerts are always on; there are no per-type settings yet.');
  await expect(main).not.toContainText('Email event alerts');

  // No alert switches in this tab; the only switch is the offer celebration one.
  await expect(main.getByRole('switch')).toHaveCount(1);
  await expect(main.getByRole('switch', { name: 'Offer celebrations' })).toHaveAttribute('aria-checked', 'true');

  await page.getByRole('link', { name: 'Open Notifications' }).click();
  await expect(page).toHaveURL('/notifications');
});

test('AI tab only offers settings the app uses', async ({ page }) => {
  await page.goto('/settings?tab=ai');

  const main = page.locator('main');
  await expect(main).toContainText('AI email analysis');
  await expect(main).not.toContainText('AI CV analysis');
  await expect(main).not.toContainText('Auto-save AI insights');
});
