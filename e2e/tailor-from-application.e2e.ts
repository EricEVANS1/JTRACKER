import { daysFromNow, expect, test, USER_ID } from './support/mockSupabase';

const JOB_DESCRIPTION = 'We are hiring a Data Analyst with SQL, Python and Power BI experience.';

test.beforeEach(({ supabase }) => {
  const base = { user_id: USER_ID, archived: false, priority: 'medium', created_at: daysFromNow(-5), date_applied: daysFromNow(-5) };
  supabase.seed('applications', [
    { ...base, id: 'app1', role_title: 'Data Analyst', status: 'applied', company_id: 'c1', job_description: JOB_DESCRIPTION, companies: { id: 'c1', name: 'Acme' } },
    { ...base, id: 'app2', role_title: 'BI Developer', status: 'applied', company_id: 'c1', job_description: null, companies: { id: 'c1', name: 'Acme' } },
    { ...base, id: 'app3', role_title: 'Analyst with analysis', status: 'interview', analysis_id: 'an1', companies: { id: 'c1', name: 'Acme' } },
    { ...base, id: 'other-users-app', user_id: 'someone-else', role_title: 'Not yours', status: 'applied', job_description: 'secret' },
  ]);
  supabase.seed('companies', [{ id: 'c1', user_id: USER_ID, name: 'Acme' }]);
});

test('Applications: "Tailor CV" opens the CV flow for that application with its job description', async ({ page }) => {
  await page.goto('/applications');

  const card = page.locator('div', { has: page.getByText('Data Analyst', { exact: true }) }).filter({ has: page.getByRole('link', { name: 'Tailor CV' }) }).last();
  await card.getByRole('link', { name: 'Tailor CV' }).click();

  await expect(page).toHaveURL('/resume-builder/flow?applicationId=app1');
  await expect(page.locator('main')).toContainText('Tailoring for "Data Analyst". Its saved job description has been filled in.');
  expect(await page.evaluate((jd) => [...document.querySelectorAll('textarea')].some((t) => t.value === jd), JOB_DESCRIPTION)).toBe(true);
});

test('applications that already have an analysis link to their tailored CV instead', async ({ page }) => {
  await page.goto('/applications');
  // Only the two applications without an analysis offer "Tailor CV".
  await expect(page.getByRole('link', { name: 'Tailor CV' })).toHaveCount(2);

  // The analysed one (listed last) has its link under "Show details".
  await page.getByRole('button', { name: 'Show details' }).last().click();
  await expect(page.getByRole('link', { name: 'Open tailored CV' })).toHaveAttribute('href', '/resume-builder/an1');
});

test('Application details: "Analyze this application" links to the CV flow for it', async ({ page }) => {
  await page.goto('/applications/app2');
  const link = page.getByRole('link', { name: 'Analyze this application' });
  await expect(link).toHaveAttribute('href', '/resume-builder/flow?applicationId=app2');

  await link.click();
  await expect(page.locator('main')).toContainText('It has no saved job description yet, so paste it below.');
});

test("an unknown or another user's application is not loaded", async ({ page, supabase }) => {
  for (const id of ['missing-app', 'other-users-app']) {
    await page.goto(`/resume-builder/flow?applicationId=${id}`);
    await expect(page.locator('main')).toContainText('That application could not be found.');
    expect(await page.evaluate(() => [...document.querySelectorAll('textarea')].some((t) => t.value.includes('secret')))).toBe(false);
  }

  // Every lookup is limited to the signed-in user's own rows.
  const lookups = supabase.requests.filter((r) => r.table === 'applications' && r.query.includes('id=eq.'));
  expect(lookups.length).toBeGreaterThan(0);
  expect(lookups.every((r) => r.query.includes(`user_id=eq.${USER_ID}`))).toBe(true);
});
