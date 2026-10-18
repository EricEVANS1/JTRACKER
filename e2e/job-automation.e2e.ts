import { expect, SUPABASE_URL, test, USER_ID } from './support/mockSupabase';

test.beforeEach(({ supabase }) => {
  supabase.seed('job_sources', [{ name: 'LinkedIn', slug: 'linkedin', fetch_method: 'serpapi', is_active: true }]);
  supabase.seed('user_job_preferences', [
    {
      id: 'prefs-1',
      user_id: USER_ID,
      target_titles: ['Data Analyst', 'BI Analyst', 'Data Engineer'],
      preferred_locations: ['Remote', 'London', 'Berlin'],
      min_match_score: 60,
      enabled_sources: ['linkedin'],
      max_job_age_days: 7,
      automation_enabled: false,
    },
  ]);
});

test('a run reports how many title and location combinations it searched', async ({ page }) => {
  let pipelineCalls = 0;
  await page.route(`${SUPABASE_URL}/functions/v1/job-pipeline`, (route) => {
    pipelineCalls++;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        success: true,
        scanned_count: 12,
        saved_count: 5,
        scored_count: 5,
        duplicate_count: 1,
        combinations_searched: [
          { title: 'Data Analyst', location: 'Remote' },
          { title: 'BI Analyst', location: 'London' },
          { title: 'Data Engineer', location: 'Berlin' },
        ],
        combinations_skipped: [
          { title: 'Data Analyst', location: 'London' },
          { title: 'Data Analyst', location: 'Berlin' },
        ],
      }),
    });
  });

  await page.goto('/job-automation');
  await page.getByRole('button', { name: 'Run Search Now' }).click();

  const main = page.locator('main');
  await expect(main).toContainText('Job search completed.');
  await expect(main).toContainText("Searched 3 of 5 title and location combinations (the rest did not fit in this run's search limit).");
  await expect(main).toContainText('Scanned: 12.');
  expect(pipelineCalls).toBe(1);
});

test('without saved titles or locations, nothing is searched and the user is told why', async ({ page, supabase }) => {
  supabase.seed('user_job_preferences', [
    { id: 'prefs-1', user_id: USER_ID, target_titles: [], preferred_locations: ['Remote'], enabled_sources: [], automation_enabled: false },
  ]);
  let pipelineCalls = 0;
  await page.route(`${SUPABASE_URL}/functions/v1/job-pipeline`, (route) => {
    pipelineCalls++;
    return route.fulfill({ status: 500, body: '{}' });
  });

  await page.goto('/job-automation');
  await page.getByRole('button', { name: 'Run Search Now' }).click();

  await expect(page.locator('main')).toContainText('Add at least one target job title and one preferred location');
  expect(pipelineCalls).toBe(0);
});

test('the automation switch shows whether automatic searches have run', async ({ page, supabase }) => {
  supabase.tables.user_job_preferences[0].automation_enabled = true;
  await page.goto('/job-automation');

  // No scheduled run yet.
  const main = page.locator('main');
  await expect(main).toContainText('On · no automatic search has run yet');

  // Preferences form.
  await page.getByRole('button', { name: 'Edit Profile' }).first().click();
  await expect(main).toContainText('Searches automatically a few times a day');
  await expect(page.getByRole('button', { name: 'On', exact: true })).toBeVisible();
});

test('the summary shows when the last automatic search ran', async ({ page, supabase }) => {
  supabase.tables.user_job_preferences[0].automation_enabled = true;
  supabase.seed('job_search_runs', [
    { id: 'r-manual', user_id: USER_ID, created_at: new Date().toISOString(), metadata: { trigger: 'manual' } },
    { id: 'r-auto', user_id: USER_ID, created_at: new Date(Date.now() - 3 * 3600_000).toISOString(), metadata: { trigger: 'scheduled' } },
  ]);
  await page.goto('/job-automation');
  await expect(page.locator('main')).toContainText('On · last automatic search 3h ago');
});

test.describe('excluded keywords', () => {
  test('can be edited and saved once the database column exists', async ({ page, supabase }) => {
    supabase.tables.user_job_preferences[0].excluded_keywords = ['Senior'];
    await page.goto('/job-automation');
    await expect(page.locator('main')).toContainText('Excluded keywords');

    await page.getByRole('button', { name: 'Edit Profile' }).first().click();
    const field = page.getByLabel('Exclude jobs mentioning');
    await expect(field).toBeEnabled();
    await expect(field).toHaveValue('Senior');

    await field.fill('Senior,  Manager , ');
    await page.getByRole('button', { name: 'Save Profile' }).first().click();
    await expect(page.locator('main')).toContainText('Search profile saved.');

    const save = supabase.writes('user_job_preferences').at(-1)!;
    expect(save.body).toMatchObject({ excluded_keywords: ['Senior', 'Manager'] });
  });

  test('explain what is needed, and are not sent, before the column exists', async ({ page, supabase }) => {
    await page.goto('/job-automation');
    await expect(page.locator('main')).not.toContainText('Excluded keywords');

    await page.getByRole('button', { name: 'Edit Profile' }).first().click();
    await expect(page.getByLabel('Exclude jobs mentioning')).toBeDisabled();
    await expect(page.locator('main')).toContainText('the database needs the excluded_keywords column');

    await page.getByRole('button', { name: 'Save Profile' }).first().click();
    await expect(page.locator('main')).toContainText('Search profile saved.');
    expect(supabase.writes('user_job_preferences').at(-1)!.body).not.toHaveProperty('excluded_keywords');
  });
});
