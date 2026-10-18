import type { Page } from '@playwright/test';

import { daysFromNow, expect, test, USER_ID } from './support/mockSupabase';

const DESCRIPTION = 'Join Globex as a BI Analyst. You will build Power BI dashboards and write SQL.';

test.beforeEach(({ supabase }) => {
  supabase.seed('cv_versions', [
    { id: 'cv-default', user_id: USER_ID, name: 'General CV', target_role: 'Analyst', cv_text: 'CV text', created_at: daysFromNow(-10) },
    { id: 'cv-matched', user_id: USER_ID, name: 'BI CV', target_role: 'BI Analyst', cv_text: 'CV text', created_at: daysFromNow(-5) },
  ]);
  supabase.seed('job_sources', [{ name: 'LinkedIn', slug: 'linkedin', fetch_method: 'serpapi', is_active: true }]);
  supabase.seed('user_job_preferences', [
    { id: 'prefs-1', user_id: USER_ID, default_cv_version_id: 'cv-default', target_titles: ['BI Analyst'], preferred_locations: ['Remote'], enabled_sources: ['linkedin'], max_job_age_days: 7, min_match_score: 60, automation_enabled: false },
  ]);
  supabase.seed('job_ads', [
    {
      id: 'job1', user_id: USER_ID, title: 'BI Analyst', company: 'Globex', location: 'Remote', job_url: 'https://jobs.example/1',
      source: 'LinkedIn', source_slug: 'linkedin', discovered_at: daysFromNow(-1), source_posted_at: daysFromNow(-1), description: DESCRIPTION, ignored: false,
      best_match_score: 82, recommendation: 'apply',
    },
    { id: 'someone-elses-job', user_id: 'someone-else', title: 'Hidden', company: 'Other', job_url: 'https://jobs.example/2', description: 'secret', ignored: false },
  ]);
  supabase.seed('job_match_results', [
    { id: 'm1', user_id: USER_ID, job_ad_id: 'job1', cv_version_id: 'cv-matched', match_score: 82, recommendation: 'apply', created_at: daysFromNow(-1) },
  ]);
});

const textareaValues = (page: Page) => page.evaluate(() => [...document.querySelectorAll('textarea')].map((t) => t.value).join('\n---\n'));

test('"Tailor CV" opens the tailoring flow with the job description and its matched CV', async ({ page }) => {
  await page.goto('/job-automation');
  await page.getByRole('button', { name: 'Tailor CV' }).first().click();

  await expect(page).toHaveURL('/resume-builder/flow?jobAdId=job1&cvVersionId=cv-matched');
  await expect(page.locator('main')).toContainText('Tailoring for "BI Analyst at Globex". The description from the job listing has been filled in');
  await expect.poll(() => textareaValues(page)).toContain(`BI Analyst at Globex\n\n${DESCRIPTION}`);

  // The CV the job was scored against is selected.
  await expect(page.getByRole('button', { name: /BI CV/ })).toHaveClass(/border-slate-900/);
  await expect(page.getByRole('button', { name: /General CV/ })).not.toHaveClass(/border-slate-900/);
});

test("another user's job or CV is not loaded", async ({ page, supabase }) => {
  await page.goto('/resume-builder/flow?jobAdId=someone-elses-job&cvVersionId=not-my-cv');

  await expect(page.locator('main')).toContainText('That job could not be found.');
  expect(await textareaValues(page)).not.toContain('secret');
  await expect(page.locator('button.border-slate-900')).toHaveCount(0);

  const lookups = supabase.requests.filter((r) => r.table === 'job_ads' && r.query.includes('id=eq.'));
  expect(lookups.length).toBeGreaterThan(0);
  expect(lookups.every((r) => r.query.includes(`user_id=eq.${USER_ID}`))).toBe(true);
});
