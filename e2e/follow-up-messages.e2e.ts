import type { Page } from '@playwright/test';

import { daysFromNow, expect, test, USER_ID } from './support/mockSupabase';

test.beforeEach(({ supabase }) => {
  supabase.seed('applications', [
    {
      id: 'app1',
      user_id: USER_ID,
      role_title: 'Data Analyst',
      status: 'applied',
      archived: false,
      priority: 'medium',
      created_at: daysFromNow(-20),
      date_applied: daysFromNow(-20),
      follow_up_date: daysFromNow(-2),
      companies: { id: 'c1', name: 'Acme' },
    },
  ]);
});

const textareaValues = (page: Page) => page.evaluate(() => [...document.querySelectorAll('textarea')].map((t) => t.value));

test('Follow-Ups messages are signed with the profile name', async ({ page }) => {
  await page.goto('/follow-ups');
  await page.getByRole('button', { name: 'Generate Message' }).first().click();

  await expect.poll(async () => (await textareaValues(page)).join('\n')).toContain('Best regards,\nAlice Example');
  expect((await textareaValues(page)).join('\n')).not.toContain('Eric');
});

test('without any name, the sign-off is left for the user to finish', async ({ page, supabase }) => {
  supabase.tables.profiles[0].full_name = null;
  await page.goto('/follow-ups');
  await page.getByRole('button', { name: 'Generate Message' }).first().click();

  await expect.poll(async () => (await textareaValues(page)).join('\n')).toMatch(/Best regards,$/);
});

test('Application details follow-up is signed with the profile name too', async ({ page }) => {
  await page.goto('/applications/app1');
  await page.getByRole('button', { name: 'Generate Follow-up Message' }).click();

  await expect.poll(async () => (await textareaValues(page)).join('\n')).toContain('Best regards,\nAlice Example');
});
